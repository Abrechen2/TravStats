import { useEffect, useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Field, Input, Select } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import { vehicleChoices } from "../../lib/roadtrip/roadtripView";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { TourRoute } from "../../types/tour";

const MAX_ODOMETER = 10_000_000;

/**
 * "Neuer Roadtrip" (design 2026-09-25, board 4): only the name is required,
 * everything else can wait. The vehicle is a row of tiles rather than a
 * select — seven choices read faster as buttons — and rail is not among them:
 * train journeys become a domain of their own (owner, 2026-09-25).
 */
export default function NewRoadtripDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (route: TourRoute) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState<RoadtripVehicle | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [odometer, setOdometer] = useState("");
  const [tripId, setTripId] = useState("");
  const [trips, setTrips] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    tripsApi
      .getAll()
      .then((rows) => !cancelled && setTrips(rows.map((r) => ({ id: r.id, name: r.name }))))
      // The trip is optional; without the list the dialog still creates.
      .catch((err: unknown) => logger.warn("Loading trips for a new roadtrip failed", err));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const odometerValue = odometer.trim() === "" ? null : Number(odometer.replace(/\s/g, ""));
  const odometerInvalid =
    odometerValue !== null &&
    (!Number.isInteger(odometerValue) || odometerValue < 0 || odometerValue > MAX_ODOMETER);

  const submit = async (): Promise<void> => {
    if (!name.trim() || odometerInvalid) return;
    setSaving(true);
    setFailed(false);
    try {
      const created = await roadtripsApi.create({
        name: name.trim(),
        vehicle,
        vehicleName: vehicleName.trim() || null,
        tripId: tripId || null,
        ...(odometerValue !== null ? { startOdometerKm: odometerValue } : {}),
      });
      onCreated(created);
    } catch (err) {
      logger.warn("Creating a roadtrip failed", err);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={600}
      title={t("roadtrips:newDialog.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button
          variant="primary"
          disabled={saving || !name.trim() || odometerInvalid}
          onClick={() => void submit()}
        >
          {t("roadtrips:newDialog.submit")}
        </Button>
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
        <p className="t-caption">{t("roadtrips:newDialog.intro")}</p>
        <Field label={t("roadtrips:newDialog.name")} htmlFor="roadtrip-new-name">
          <Input
            id="roadtrip-new-name"
            value={name}
            autoFocus
            placeholder={t("roadtrips:namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
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
            {vehicleChoices(vehicle).map((v) => {
              const on = v === vehicle;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setVehicle(on ? null : v)}
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
          <Field
            label={`${t("roadtrips:newDialog.vehicleName")} · ${t("roadtrips:newDialog.optional")}`}
            htmlFor="roadtrip-new-vehicle-name"
          >
            <Input
              id="roadtrip-new-vehicle-name"
              value={vehicleName}
              onChange={(e) => setVehicleName(e.target.value)}
            />
          </Field>
          <Field
            label={`${t("roadtrips:newDialog.odometer")} · ${t("roadtrips:newDialog.optional")}`}
            htmlFor="roadtrip-new-odometer"
          >
            <Input
              id="roadtrip-new-odometer"
              inputMode="numeric"
              value={odometer}
              invalid={odometerInvalid}
              onChange={(e) => setOdometer(e.target.value)}
              style={{ fontFamily: "var(--ts-font-mono)" }}
            />
          </Field>
        </div>

        <Field
          label={`${t("roadtrips:newDialog.trip")} · ${t("roadtrips:newDialog.optional")}`}
          htmlFor="roadtrip-new-trip"
          hint={t("roadtrips:newDialog.tripHint")}
        >
          <Select id="roadtrip-new-trip" value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">{t("roadtrips:newDialog.noTrip")}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </Select>
        </Field>

        {failed && (
          <p role="alert" style={{ color: "var(--ts-bad)", fontSize: 13 }}>
            {t("roadtrips:createError")}
          </p>
        )}
      </form>
    </Dialog>
  );
}
