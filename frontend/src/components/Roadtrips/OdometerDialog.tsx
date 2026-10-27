import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Field, Input } from "../ui/Field";
import { FormErrorBanner, useFormFailure } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { readOdometer } from "./NewRoadtripDialog";

const START_ID = "roadtrip-odometer-start";
const END_ID = "roadtrip-odometer-end";

const asText = (km: number | null): string => (km === null ? "" : String(km));

/**
 * The two odometer readings of a roadtrip (forgejo#280 point 1). Both entered
 * make a finished roadtrip "Gefahren" without a GPS track, with their
 * difference as the km; an emptied field is null — unknown, never 0. An end
 * below the start cannot be a reading pair and is refused here, before the
 * page would quietly ignore it.
 */
export default function OdometerDialog({
  routeId,
  startOdometerKm,
  endOdometerKm,
  onClose,
  onSaved,
}: {
  routeId: string;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [startText, setStartText] = useState(asText(startOdometerKm));
  const [endText, setEndText] = useState(asText(endOdometerKm));
  const [saving, setSaving] = useState(false);
  const failure = useFormFailure(`${startText}|${endText}`);

  const start = readOdometer(startText);
  const end = readOdometer(endText);
  const backwards = start.value !== null && end.value !== null && end.value < start.value;
  const blocked = start.invalid || end.invalid || backwards;
  const dirty = startText !== asText(startOdometerKm) || endText !== asText(endOdometerKm);

  const submit = async (): Promise<void> => {
    if (blocked || saving) return;
    failure.clear();
    setSaving(true);
    try {
      await toursApi.update(undefined, routeId, {
        startOdometerKm: start.value,
        endOdometerKm: end.value,
      });
      onSaved();
    } catch (err: unknown) {
      logger.warn("Saving a roadtrip's odometer readings failed", err);
      failure.fail(saveErrorKey(err, "roadtrips:odometerDialog.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={saving}
      dirty={dirty}
      maxWidth={480}
      title={t("roadtrips:odometerDialog.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" disabled={saving || blocked} onClick={() => void submit()}>
          {saving ? t("common:buttons.saving") : t("roadtrips:odometerDialog.save")}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div ref={failure.rootRef} className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <p className="t-caption">{t("roadtrips:odometerDialog.intro")}</p>
          <div className="grid sm:grid-cols-2" style={{ gap: "var(--ts-space-md)" }}>
            <Field
              label={t("roadtrips:odometerDialog.start")}
              htmlFor={START_ID}
              error={start.invalid ? t("roadtrips:newDialog.odometerInvalid") : undefined}
            >
              <Input
                id={START_ID}
                inputMode="numeric"
                value={startText}
                invalid={start.invalid}
                onChange={(e) => setStartText(e.target.value)}
                style={{ fontFamily: "var(--ts-font-mono)" }}
              />
            </Field>
            <Field
              label={t("roadtrips:odometerDialog.end")}
              htmlFor={END_ID}
              error={
                end.invalid
                  ? t("roadtrips:newDialog.odometerInvalid")
                  : backwards
                    ? t("roadtrips:odometerDialog.backwards")
                    : undefined
              }
            >
              <Input
                id={END_ID}
                inputMode="numeric"
                value={endText}
                invalid={end.invalid || backwards}
                onChange={(e) => setEndText(e.target.value)}
                style={{ fontFamily: "var(--ts-font-mono)" }}
              />
            </Field>
          </div>
          <p className="t-caption">{t("roadtrips:newDialog.odometerHint")}</p>
          <FormErrorBanner
            message={failure.failureKey ? t(failure.failureKey) : null}
            onRetry={
              failure.failureKey && isTransientSaveError(failure.failureKey)
                ? () => void submit()
                : undefined
            }
            retryDisabled={saving}
          />
        </div>
      </form>
    </Dialog>
  );
}
