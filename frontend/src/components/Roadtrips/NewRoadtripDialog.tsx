import { useEffect, useState } from "react";
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
import { roadtripsApi } from "../../lib/api/roadtrips";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import { vehicleChoices } from "../../lib/roadtrip/roadtripView";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { TourRoute } from "../../types/tour";

const MAX_ODOMETER = 10_000_000;
const NAME_ID = "roadtrip-new-name";
const ODOMETER_ID = "roadtrip-new-odometer";
const HINT_ID = "roadtrip-new-save-blocked";

interface Draft {
  name: string;
  vehicle: RoadtripVehicle | null;
  vehicleName: string;
  odometer: string;
  tripId: string;
}

/** The empty draft of one opening — the state's start AND the dirty baseline. */
function emptyDraft(): Draft {
  return { name: "", vehicle: null, vehicleName: "", odometer: "", tripId: "" };
}

/** The odometer as a number (null when empty); `invalid` when the text cannot be a reading. */
export function readOdometer(text: string): { value: number | null; invalid: boolean } {
  if (text.trim() === "") return { value: null, invalid: false };
  const value = Number(text.replace(/\s/g, ""));
  const invalid = !Number.isInteger(value) || value < 0 || value > MAX_ODOMETER;
  return { value: invalid ? null : value, invalid };
}

/**
 * "Neuer Roadtrip" (design 2026-09-25, board 4): only the name is required,
 * everything else can wait. The vehicle is a row of tiles rather than a
 * select — seven choices read faster as buttons — and rail is not among them:
 * train journeys become a domain of their own (owner, 2026-09-25).
 *
 * Pattern (forgejo#245): "disabled save + `SaveBlockedHint`". The name is the
 * one required field and is marked as such. The optional fields are no longer
 * labelled "· optional": that inverse marking said the same thing backwards
 * and left the one required field as the only unmarked one.
 *
 * The dialog stays MOUNTED while closed (the list renders it with
 * `open=false`), so every opening starts over: the draft, the dirty baseline
 * and the "saved once" memory reset in the render that opens it. Before, the
 * second "Neuer Roadtrip" of a session opened on the first one's name.
 */
export default function NewRoadtripDialog({
  open,
  onClose,
  onCreated,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (route: TourRoute) => void;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [trips, setTrips] = useState<Array<{ id: string; name: string }>>([]);
  const [tripsFailed, setTripsFailed] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(emptyDraft());
  }

  const { dirty, markSaved } = useDirtyGuard(emptyDraft(), draft, { open });
  const saving = useSaveOnce<TourRoute>({ open });
  const failure = useFormFailure(JSON.stringify(draft));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTripsFailed(false);
    tripsApi
      .getAll()
      .then((rows) => !cancelled && setTrips(rows.map((r) => ({ id: r.id, name: r.name }))))
      // The trip is optional, so the dialog still creates without the list —
      // but it says so, rather than offering "Keine Reise" as if that were all.
      .catch((err: unknown) => {
        logger.warn("Loading trips for a new roadtrip failed", err);
        if (!cancelled) setTripsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const odometer = readOdometer(draft.odometer);
  const missing: MissingStep[] = [
    ...(draft.name.trim() === "" ? [{ field: NAME_ID, label: t("roadtrips:newDialog.name") }] : []),
    ...(odometer.invalid
      ? [{ field: ODOMETER_ID, label: t("roadtrips:newDialog.odometerMissing") }]
      : []),
  ];

  const submit = async (): Promise<void> => {
    if (missing.length > 0) return;
    failure.clear();
    const outcome = await saving.save(
      () =>
        roadtripsApi.create({
          name: draft.name.trim(),
          vehicle: draft.vehicle,
          vehicleName: draft.vehicleName.trim() || null,
          tripId: draft.tripId || null,
          ...(odometer.value !== null ? { startOdometerKm: odometer.value } : {}),
        }),
      (created) => {
        markSaved();
        onCreated(created);
      }
    );
    if (outcome.status === "failed") {
      logger.warn("Creating a roadtrip failed", outcome.error);
      // Always a create: a lost answer may have stored the roadtrip.
      failure.fail(saveErrorKey(outcome.error, "roadtrips:createError", {}, { create: true }));
    }
  };

  const failureKey = failure.failureKey;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      maxWidth={600}
      title={t("roadtrips:newDialog.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        // Stored, but the follow-up failed: another press would send nothing
        // (`useSaveOnce`), so the only honest way on is to close.
        saving.afterSaveFailed ? undefined : (
          <div className="flex flex-col items-end" style={{ gap: "var(--ts-space-xs)" }}>
            <Button
              variant="primary"
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              onClick={() => void submit()}
            >
              {saving.saving ? t("common:buttons.saving") : t("roadtrips:newDialog.submit")}
            </Button>
            <SaveBlockedHint id={HINT_ID} missing={missing} />
          </div>
        )
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
          <p className="t-caption">{t("roadtrips:newDialog.intro")}</p>
          <Field
            label={
              <>
                {t("roadtrips:newDialog.name")} <RequiredMark />
              </>
            }
            htmlFor={NAME_ID}
          >
            <Input
              id={NAME_ID}
              value={draft.name}
              autoFocus
              aria-required="true"
              placeholder={t("roadtrips:namePlaceholder")}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>

          <fieldset
            className="flex flex-col"
            style={{ gap: "var(--ts-space-sm)", border: 0, padding: 0, margin: 0 }}
          >
            <legend className="t-caption" style={{ marginBottom: "var(--ts-space-sm)" }}>
              {t("roadtrips:newDialog.vehicle")}
            </legend>
            <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: "var(--ts-space-sm)" }}>
              {vehicleChoices(draft.vehicle).map((v) => {
                const on = v === draft.vehicle;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("vehicle", on ? null : v)}
                    style={{
                      minHeight: "var(--ts-size-touch-min)",
                      borderRadius: "var(--ts-radius-button)",
                      border: `2px solid ${on ? "var(--domain-roadtrip)" : "var(--ts-border)"}`,
                      background: on ? "var(--domain-roadtrip-soft)" : "var(--ts-surface)",
                      color: on ? "var(--ts-text-bright)" : "var(--ts-text)",
                      fontWeight: on ? 800 : 500,
                      fontSize: 14,
                    }}
                  >
                    {t(`roadtrips:vehicle.${v}`)}
                  </button>
                );
              })}
            </div>
            <span className="t-caption">{t("roadtrips:newDialog.railHint")}</span>
          </fieldset>

          <div className="grid sm:grid-cols-2" style={{ gap: "var(--ts-space-md)" }}>
            <Field label={t("roadtrips:newDialog.vehicleName")} htmlFor="roadtrip-new-vehicle-name">
              <Input
                id="roadtrip-new-vehicle-name"
                value={draft.vehicleName}
                onChange={(e) => set("vehicleName", e.target.value)}
              />
            </Field>
            <Field
              label={t("roadtrips:newDialog.odometer")}
              htmlFor={ODOMETER_ID}
              hint={t("roadtrips:newDialog.odometerHint")}
              // Said as soon as it is wrong: a number that cannot be a reading
              // is not something to wait for a save attempt to point out.
              error={odometer.invalid ? t("roadtrips:newDialog.odometerInvalid") : undefined}
            >
              <Input
                id={ODOMETER_ID}
                inputMode="numeric"
                value={draft.odometer}
                invalid={odometer.invalid}
                onChange={(e) => set("odometer", e.target.value)}
                style={{ fontFamily: "var(--ts-font-mono)" }}
              />
            </Field>
          </div>

          <Field
            label={t("roadtrips:newDialog.trip")}
            htmlFor="roadtrip-new-trip"
            hint={
              tripsFailed ? t("roadtrips:newDialog.tripsFailed") : t("roadtrips:newDialog.tripHint")
            }
          >
            <Select
              id="roadtrip-new-trip"
              value={draft.tripId}
              onChange={(e) => set("tripId", e.target.value)}
            >
              <option value="">{t("roadtrips:newDialog.noTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </Select>
          </Field>

          <RequiredLegend />

          <FormErrorBanner
            message={failureKey ? t(failureKey) : null}
            onRetry={
              failureKey && isTransientSaveError(failureKey) ? () => void submit() : undefined
            }
            retryDisabled={saving.saving}
            onReload={failureKey && isOutcomeUnknownSaveError(failureKey) ? onReload : undefined}
          />
          {saving.afterSaveFailed && (
            <p role="status" className="t-caption">
              {t(saving.afterSaveFailedKey)}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
