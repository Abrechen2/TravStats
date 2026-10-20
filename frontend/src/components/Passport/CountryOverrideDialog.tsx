import { useEffect, useMemo, useState } from "react";

import Modal from "../Modal";
import Button from "../ui/Button";
import { Field, Input, Select, TextArea } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { passportOverridesApi } from "../../lib/api/passportOverrides";
import { logger } from "../../lib/logger";
import type { CountryOverrideVerdict, CountryOverrideView } from "../../types/passport";
import { countryName } from "./countryName";
import { overrideErrorKey } from "./overrideErrors";

/**
 * Add or correct a country by hand (forgejo#308).
 *
 * Without `target` it ADDS: the country is picked from the codes the server
 * accepts (fetched here, so the picker can never offer one a save refuses).
 * With `target` it CORRECTS that country, prefilled when it already carries an
 * override, and offers to delete that override.
 *
 * A failure stays in the dialog and says which one it was — a save that did
 * not happen must never close the form as if it had. `onChanged` reloads the
 * passport; the dialog only closes once that succeeded or said it failed.
 */

const VERDICTS: readonly CountryOverrideVerdict[] = ["visited", "ground", "excluded"];

export interface CountryOverrideTarget {
  code: string;
  override: CountryOverrideView | null;
}

interface Props {
  open: boolean;
  target: CountryOverrideTarget | null;
  locale: string;
  onClose: () => void;
  /** Reload the passport after a write. */
  onChanged: () => Promise<void>;
}

export default function CountryOverrideDialog({
  open,
  target,
  locale,
  onClose,
  onChanged,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["passport"]);
  const [knownCountries, setKnownCountries] = useState<string[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [code, setCode] = useState("");
  const [verdict, setVerdict] = useState<CountryOverrideVerdict>("visited");
  const [note, setNote] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; note?: string }>({});

  const editing = target !== null;

  // Reset the form whenever the dialog opens, from the target if there is one.
  useEffect(() => {
    if (!open) return;
    setCode(target?.code ?? "");
    setVerdict(target?.override?.verdict ?? "visited");
    setNote(target?.override?.note ?? "");
    setDay(target?.override?.day ?? "");
    setError(null);
    setFieldErrors({});
    setBusy(null);
  }, [open, target]);

  // Only adding needs the picker, so only adding asks for the codes.
  useEffect(() => {
    if (!open || editing) return;
    let live = true;
    setListFailed(false);
    passportOverridesApi
      .list()
      .then((list) => {
        if (live) setKnownCountries(list.knownCountries);
      })
      .catch((err) => {
        if (!live) return;
        setListFailed(true);
        logger.error("Failed to load passport overrides:", err);
      });
    return () => {
      live = false;
    };
  }, [open, editing]);

  const options = useMemo(
    () =>
      (knownCountries ?? [])
        .map((c) => [c, countryName(c, locale)] as const)
        .sort((a, b) => a[1].localeCompare(b[1], locale)),
    [knownCountries, locale]
  );

  const dirty =
    note !== (target?.override?.note ?? "") ||
    verdict !== (target?.override?.verdict ?? "visited") ||
    day !== (target?.override?.day ?? "") ||
    (!editing && code !== "");

  const finish = async (): Promise<void> => {
    try {
      await onChanged();
      onClose();
    } catch (err) {
      logger.error("Failed to reload passport after an override:", err);
      setError(t("passport:overrides.reloadError"));
    }
  };

  const save = async (): Promise<void> => {
    const errors = {
      code: code === "" ? t("passport:overrides.countryRequired") : undefined,
      note: note.trim() === "" ? t("passport:overrides.noteRequired") : undefined,
    };
    setFieldErrors(errors);
    if (errors.code || errors.note) return;
    setBusy("save");
    setError(null);
    try {
      await passportOverridesApi.save(code, { verdict, note: note.trim(), day: day || null });
    } catch (err) {
      logger.error("Failed to save passport override:", err);
      setError(t(overrideErrorKey(err, "passport:overrides.saveError")));
      setBusy(null);
      return;
    }
    await finish();
    setBusy(null);
  };

  const remove = async (): Promise<void> => {
    setBusy("delete");
    setError(null);
    try {
      await passportOverridesApi.remove(code);
    } catch (err) {
      logger.error("Failed to delete passport override:", err);
      setError(t(overrideErrorKey(err, "passport:overrides.deleteError")));
      setBusy(null);
      return;
    }
    await finish();
    setBusy(null);
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy !== null}
      dirty={dirty}
      title={t(editing ? "passport:overrides.editTitle" : "passport:overrides.addTitle")}
      testId="country-override-dialog"
      footer={(requestClose) => (
        <div className="flex flex-wrap justify-end gap-2">
          {editing && target?.override && (
            <Button variant="danger" onClick={() => void remove()} disabled={busy !== null}>
              {t(busy === "delete" ? "passport:overrides.deleting" : "passport:overrides.delete")}
            </Button>
          )}
          <Button onClick={requestClose} disabled={busy !== null}>
            {t("passport:overrides.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy !== null}>
            {t(busy === "save" ? "passport:overrides.saving" : "passport:overrides.save")}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        {editing ? (
          <p className="text-sm font-medium">
            <span className="font-mono text-xs mr-2 opacity-70">{code}</span>
            {countryName(code, locale)}
          </p>
        ) : listFailed ? (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {t("passport:overrides.loadError")}
          </p>
        ) : (
          <Field
            label={t("passport:overrides.country")}
            htmlFor="override-country"
            error={fieldErrors.code}
          >
            <Select
              id="override-country"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={knownCountries === null}
            >
              <option value="">{t("passport:overrides.countryPlaceholder")}</option>
              {options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="t-caption mb-1" style={{ color: "var(--ts-muted)" }}>
            {t("passport:overrides.verdictLegend")}
          </legend>
          {VERDICTS.map((v) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="override-verdict"
                value={v}
                checked={verdict === v}
                onChange={() => setVerdict(v)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t(`passport:overrides.verdict.${v}`)}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {t(`passport:overrides.verdict.${v}Hint`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <Field
          label={t("passport:overrides.note")}
          htmlFor="override-note"
          error={fieldErrors.note}
          hint={t("passport:overrides.noteHint")}
        >
          <TextArea
            id="override-note"
            value={note}
            maxLength={500}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <Field
          label={t("passport:overrides.day")}
          htmlFor="override-day"
          hint={t("passport:overrides.dayHint")}
        >
          <Input
            id="override-day"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
