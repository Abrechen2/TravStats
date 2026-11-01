import { useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import {
  ActionControl,
  ChoiceControl,
  ErrorLine,
  GroupStateMark,
  InputControl,
  SecretControl,
  SettingItem,
  SwitchControl,
  useGroupSave,
} from "../ui/settings";
import type { ServiceField } from "../../lib/api/externalServices";
import { fieldLabel, optionLabel } from "../ExternalServices/serviceText";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import type { RowLock } from "./useLockFor";

type Draft = Record<string, string | boolean>;

function draftOf(fields: readonly ServiceField[]): Draft {
  return Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.kind === "switch"
        ? f.value === true
        : f.kind === "secret" || f.value === null || f.value === undefined
          ? ""
          : String(f.value),
    ])
  );
}

interface FieldsGroupProps {
  /** Unique on the page; the leave warning keys on it. */
  id: string;
  /** Names the group in the leave question. */
  label: string;
  serviceId: string;
  fields: readonly ServiceField[];
  /** Which design template names the `apiKey` row. */
  secretTemplate: "ownKey" | "instKey";
  /** The write; throws (with the server's error) when it fails. */
  write: (changes: Record<string, unknown>) => Promise<void>;
  /** The button says "Speichern & testen" when saving also tests. */
  tests: boolean;
  lock?: RowLock;
  /** Shown under the group: the failure of the last save, in words. */
  errorText: string | null;
  /** Rows the caller adds under the fields (its own, e.g. a model list). */
  children?: ReactNode;
  /** Take a stored secret out for good (sends `""`). */
  onRemoveSecret?: (key: string) => Promise<void>;
}

/**
 * The credential fields of one side of a service as ONE group with a save
 * button (B6, group half): standard shows keys and on/off style fields, the
 * rest (addresses, models, ports, folders) is Expert. A secret is write-only:
 * empty keeps the stored one. A failed save keeps the draft and says why.
 */
export default function FieldsGroup({
  id,
  label,
  serviceId,
  fields,
  secretTemplate,
  write,
  tests,
  lock,
  errorText,
  children,
  onRemoveSecret,
}: FieldsGroupProps): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "externalServices"]);
  const hiddenCount = fields.filter((f) => f.expert).length;
  const expert = useExpertRows(hiddenCount);
  const [rev, setRev] = useState(0);
  const group = useGroupSave<Draft>({
    id,
    label,
    saved: draftOf(fields),
    write: async (draft) => {
      const changes: Record<string, unknown> = {};
      for (const f of fields) {
        const next = draft[f.key];
        if (next === undefined || next === draftOf([f])[f.key]) continue;
        changes[f.key] = f.kind === "number" && next !== "" ? Number(next) : next;
      }
      if (Object.keys(changes).length === 0) return;
      await write(changes);
      setRev((n) => n + 1);
      // A secret is write-only: once sent it must not stay in the draft, or the
      // next save would send it again (and bring back one the user removed).
      return Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          fields.find((f) => f.key === key)?.kind === "secret" ? "" : value,
        ])
      );
    },
  });
  const shown = fields.filter((f) => expert || !f.expert);
  if (shown.length === 0) return null;

  const titleOf = (f: ServiceField): string =>
    f.kind === "secret" && f.key === "apiKey"
      ? t(`settingsRows:services.tpl.${secretTemplate}.t`)
      : fieldLabel(t, serviceId, f);
  const subOf = (f: ServiceField): string | undefined =>
    f.kind === "secret" && f.key === "apiKey"
      ? t(`settingsRows:services.tpl.${secretTemplate}.s`, { defaultValue: "" }) || undefined
      : undefined;
  const helpOf = (f: ServiceField): string | undefined =>
    f.kind === "secret" && f.key === "apiKey"
      ? t(`settingsRows:services.tpl.${secretTemplate}.h`, { defaultValue: "" }) || undefined
      : undefined;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }} data-fields-group={id}>
      {shown.map((f) => {
        const value = group.draft[f.key];
        const common = {
          title: titleOf(f),
          sub: subOf(f),
          help: helpOf(f),
          expert: f.expert,
          locked: lock,
          changed: group.isChanged(f.key),
        };
        if (f.kind === "switch") {
          return (
            <SettingItem
              key={f.key}
              {...common}
              control={
                <SwitchControl
                  checked={value === true}
                  onChange={(next) => group.edit({ [f.key]: next })}
                />
              }
            />
          );
        }
        if (f.kind === "secret") {
          const isSet = f.value !== null && f.value !== undefined && f.value !== "";
          return (
            <SettingItem
              key={f.key}
              {...common}
              control={
                <>
                  <SecretControl
                    key={`${f.key}-${rev}`}
                    isSet={isSet}
                    onChange={(typed) => group.edit({ [f.key]: typed })}
                  />
                  {isSet && onRemoveSecret && !lock ? (
                    <ActionControl
                      label={t("settingsRows:services.ui.removeSecret")}
                      onClick={() => {
                        group.edit({ [f.key]: "" });
                        setRev((n) => n + 1);
                        void onRemoveSecret(f.key);
                      }}
                    />
                  ) : null}
                </>
              }
            />
          );
        }
        if (f.kind === "select" && f.options && f.options.length > 0) {
          return (
            <SettingItem
              key={f.key}
              {...common}
              control={
                <ChoiceControl<string>
                  label={titleOf(f)}
                  value={String(value ?? "")}
                  options={f.options.map((o) => ({
                    value: o,
                    label: optionLabel(t, serviceId, f.key, o),
                  }))}
                  onChange={(next) => group.edit({ [f.key]: next })}
                />
              }
            />
          );
        }
        return (
          <SettingItem
            key={f.key}
            {...common}
            control={
              <InputControl
                type={f.kind === "number" ? "number" : f.kind === "url" ? "url" : "text"}
                inputMode={f.kind === "number" ? "numeric" : f.kind === "url" ? "url" : "text"}
                value={String(value ?? "")}
                onChange={(next) => group.edit({ [f.key]: next })}
              />
            }
          />
        );
      })}
      {children}
      {errorText ? <ErrorLine>{errorText}</ErrorLine> : null}
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <Button
          variant="primary"
          disabled={Boolean(lock) || group.state === "unchanged" || group.state === "saving"}
          onClick={() => void group.save()}
        >
          {t(tests ? "settingsRows:services.ui.saveAndTest" : "settingsRows:services.ui.save")}
        </Button>
        {group.state === "dirty" || group.state === "failed" ? (
          <Button
            variant="secondary"
            onClick={() => {
              group.discard();
              // The secret field keeps what was typed itself: start it empty again.
              setRev((n) => n + 1);
            }}
          >
            {t("settingsRows:services.ui.discard")}
          </Button>
        ) : null}
        <GroupStateMark state={group.state} reason={group.reason} />
      </div>
    </div>
  );
}
