import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { createPlaceList } from "../../lib/api/placeLists";
import { LIST_PALETTE_HEX } from "../../lib/listPalette";
import { logger } from "../../lib/logger";
import type { PlaceLabelMode } from "../../lib/placeLabel";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import type { PlaceList } from "../../types/placeList";
import {
  FormErrorBanner,
  RequiredLegend,
  RequiredMark,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { PlaceListLabelFields, hasSymbol } from "./PlaceListLabelFields";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";
const COARSE_BOX = `${COARSE} pointer-coarse:min-w-(--ts-size-touch-min)`;
const NAME_ID = "place-list-create-name";
const HINT_ID = "place-list-create-blocked";

/**
 * A new own list (forgejo#245–#249). It was an inline panel on the lists
 * page: the save button greyed out on an empty name and said nothing, a
 * refusal was a toast, and Escape or a tap elsewhere was no question at all.
 *
 * Pattern: **disabled save + `SaveBlockedHint`** — the name is the one thing a
 * list cannot do without.
 */
export function PlaceListCreateDialog({
  onClose,
  onCreated,
  onReload,
}: {
  onClose: () => void;
  /** Moves on to the new list. */
  onCreated: (list: PlaceList) => void | Promise<void>;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const initial = { name: "", color: LIST_PALETTE_HEX[0], icon: "", labelMode: "name" };
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<string>(initial.color);
  const [icon, setIcon] = useState(initial.icon);
  const [labelMode, setLabelMode] = useState<PlaceLabelMode>("name");

  const snapshot = { name, color, icon, labelMode };
  const { dirty, markSaved } = useDirtyGuard(initial, snapshot);
  const saving = useSaveOnce<PlaceList>();
  const failure = useFormFailure(JSON.stringify(snapshot));

  const missing: MissingStep[] =
    name.trim() === "" ? [{ field: NAME_ID, label: t("places:lists.nameLabel") }] : [];

  const handleSave = async (): Promise<void> => {
    if (missing.length > 0) return;
    failure.clear();
    const outcome = await saving.save(
      () =>
        createPlaceList({
          name: name.trim(),
          color,
          // An empty input means "no symbol", stored as null rather than as an
          // empty string nothing can tell apart from a space.
          icon: hasSymbol(icon) ? icon.trim() : null,
          labelMode,
        }),
      async (created) => {
        markSaved();
        await onCreated(created);
      }
    );
    if (outcome.status === "failed") {
      logger.error({ err: outcome.error }, "PlaceListCreateDialog: create failed");
      // Always a create: a lost answer may have stored the list.
      failure.fail(saveErrorKey(outcome.error, "places:lists.createFailed", {}, { create: true }));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      maxWidth={520}
      closeLabel={t("common:buttons.close")}
      title={t("places:lists.createTitle")}
      footer={(requestClose) =>
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button type="button" onClick={onClose} className={`btn-primary ${COARSE}`}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={HINT_ID} missing={missing} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving.saving}
              className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className={`btn-primary disabled:opacity-50 ${COARSE}`}
            >
              {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={NAME_ID} className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.nameLabel")} <RequiredMark />
          </label>
          <input
            id={NAME_ID}
            aria-required="true"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("places:lists.namePlaceholder")}
            className={`w-full rounded-lg px-3 py-2 text-sm ${COARSE}`}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.colorLabel")}
          </legend>
          <div className="flex flex-wrap items-center gap-1">
            {LIST_PALETTE_HEX.map((c) => (
              // The swatch stays 22 px; the button around it reaches the touch
              // minimum on a coarse pointer (forgejo#249). `aria-pressed` says
              // which one is chosen — the ring alone was visual only.
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`inline-flex items-center justify-center ${COARSE_BOX}`}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: c,
                    border:
                      color === c
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--color-border)",
                  }}
                />
              </button>
            ))}
          </div>
        </fieldset>
        <PlaceListLabelFields
          icon={icon}
          onIconChange={setIcon}
          labelMode={labelMode}
          onLabelModeChange={setLabelMode}
        />
        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? () => void handleSave()
              : undefined
          }
          retryDisabled={saving.saving}
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
        <RequiredLegend />
      </div>
    </Modal>
  );
}
