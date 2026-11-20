import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Field, Input, Select } from "../ui/Field";
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
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import { TOUR_ACTIVITIES, type TourActivity } from "../../shared/tour/roadtrip";
import { SELECTABLE_LEG_MODES, type LegMode, type TourRoute } from "../../types/tour";

const NAME_ID = "tour-new-name";
const HINT_ID = "tour-new-save-blocked";

interface Draft {
  name: string;
  mode: LegMode;
  activity: TourActivity | "";
  date: string;
  startTime: string;
}

/** The draft of one opening — the state's start AND the dirty baseline. */
function emptyDraft(): Draft {
  return { name: "", mode: "road", activity: "hike", date: "", startTime: "" };
}

/**
 * "Neue Tour": the dialog every other logbook creates in, with the one
 * required field marked and a hint that says what blocks the save. Only the
 * name is required; the day and its start are optional, a recording can fill
 * them later. The dialog stays mounted while closed, so each opening starts
 * over (the draft, the dirty baseline and the saved-once memory).
 */
export default function NewTourDialog({
  open,
  onClose,
  onCreated,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (route: TourRoute) => void;
  /** Re-reads the list WITHOUT closing the form, offered when a create's answer was lost. */
  onReload?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["trips", "roadtrips", "common"]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(emptyDraft());
  }

  const { dirty, markSaved } = useDirtyGuard(emptyDraft(), draft, { open });
  const saving = useSaveOnce<TourRoute>({ open });
  const failure = useFormFailure(JSON.stringify(draft));

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const missing: MissingStep[] =
    draft.name.trim() === "" ? [{ field: NAME_ID, label: t("trips:tours.newDialog.name") }] : [];

  const submit = async (): Promise<void> => {
    if (missing.length > 0) return;
    failure.clear();
    const outcome = await saving.save(
      () =>
        toursApi.createStandalone({
          name: draft.name.trim(),
          mode: draft.mode,
          activity: draft.activity === "" ? null : draft.activity,
          ...(draft.date ? { date: draft.date, startTime: draft.startTime || null } : {}),
        }),
      (created) => {
        markSaved();
        onCreated(created);
      }
    );
    if (outcome.status === "failed") {
      logger.warn("Creating a tour failed", outcome.error);
      failure.fail(saveErrorKey(outcome.error, "trips:tours.createError", {}, { create: true }));
    }
  };

  const failureKey = failure.failureKey;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      maxWidth={560}
      title={t("trips:tours.newDialog.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <div className="flex flex-col items-end" style={{ gap: "var(--ts-space-xs)" }}>
          <Button
            variant="primary"
            disabled={saving.saving || saving.saved !== null || missing.length > 0}
            aria-describedby={HINT_ID}
            onClick={() => void submit()}
          >
            {saving.saving ? t("common:buttons.saving") : t("trips:tours.newDialog.submit")}
          </Button>
          <SaveBlockedHint id={HINT_ID} missing={missing} />
        </div>
      }
    >
      <form
        className="flex flex-col"
        style={{ gap: "var(--ts-space-lg)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div ref={failure.rootRef} className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <p className="t-caption">{t("trips:tours.newDialog.intro")}</p>
          <Field
            label={
              <>
                {t("trips:tours.newDialog.name")} <RequiredMark />
              </>
            }
            htmlFor={NAME_ID}
          >
            <Input
              id={NAME_ID}
              value={draft.name}
              autoFocus
              aria-required="true"
              placeholder={t("trips:tours.namePlaceholder")}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <div className="grid sm:grid-cols-2" style={{ gap: "var(--ts-space-md)" }}>
            <Field label={t("roadtrips:activityLabel")} htmlFor="tour-new-activity">
              <Select
                id="tour-new-activity"
                value={draft.activity}
                onChange={(e) => set("activity", e.target.value as TourActivity | "")}
              >
                <option value="">{t("roadtrips:activityNone")}</option>
                {TOUR_ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {t(`roadtrips:activity.${a}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("trips:tours.modeLabel")} htmlFor="tour-new-mode">
              <Select
                id="tour-new-mode"
                value={draft.mode}
                onChange={(e) => set("mode", e.target.value as LegMode)}
              >
                {SELECTABLE_LEG_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`trips:tours.mode.${mode}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("trips:tours.day.date")} htmlFor="tour-new-date">
              <Input
                id="tour-new-date"
                type="date"
                value={draft.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label={t("trips:tours.day.startTime")} htmlFor="tour-new-start">
              <Input
                id="tour-new-start"
                type="time"
                value={draft.startTime}
                disabled={!draft.date}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </Field>
          </div>
          <RequiredLegend />
          <FormErrorBanner
            message={failureKey ? t(failureKey) : null}
            onRetry={
              failureKey && isTransientSaveError(failureKey) ? () => void submit() : undefined
            }
            retryDisabled={saving.saving}
            onReload={failureKey && isOutcomeUnknownSaveError(failureKey) ? onReload : undefined}
          />
        </div>
      </form>
    </Dialog>
  );
}
