import { useEffect, useId, useRef, useState } from "react";
import Modal from "../Modal";
import RequiredLegend from "../form/RequiredLegend";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { ferryApi } from "../../lib/api/ferry";
import { tripsApi } from "../../lib/api";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import type { FerryJourney } from "../../types/ferry";
import type { Trip } from "../../types";
import { FerryStationField, EMPTY_TERMINAL, type FerryStationDraft } from "./FerryStationField";

const TEXT = [
  "operator",
  "vesselName",
  "bookingReference",
  "ticketReference",
  "vehicleType",
  "vehicleRegistration",
  "cabinType",
  "seat",
  "currency",
  "notes",
] as const;
const NUMBERS = [
  "passengerCount",
  "vehicleLengthM",
  "vehicleWidthM",
  "vehicleHeightM",
  "price",
  "distanceKm",
] as const;
const INPUT =
  "mt-1 w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent)";
function port(ride: FerryJourney | null, prefix: "dep" | "arr"): FerryStationDraft {
  return ride
    ? {
        name: ride[`${prefix}StationName`],
        address: ride[`${prefix}Address`] ?? "",
        lat: ride[`${prefix}Lat`],
        lon: ride[`${prefix}Lon`],
        country: ride[`${prefix}Country`],
      }
    : { ...EMPTY_TERMINAL };
}
function initial(ride: FerryJourney | null) {
  const fields: Record<string, string> = {};
  for (const key of [...TEXT, ...NUMBERS])
    fields[key] = String(ride?.[key] ?? (key === "currency" ? "EUR" : ""));
  fields.departureLocal = ride ? (railDeparture(ride)?.local.slice(0, 16) ?? "") : "";
  fields.arrivalLocal = ride ? (railArrival(ride)?.local.slice(0, 16) ?? "") : "";
  fields.companions = ride?.companions.join(", ") ?? "";
  fields.tripId = ride?.tripId ?? "";
  fields.departureFold = "";
  fields.arrivalFold = "";
  return fields;
}
export function FerryFormModal({
  journey,
  onClose,
  onSaved,
}: {
  journey: FerryJourney | null;
  onClose: () => void;
  onSaved: (ride: FerryJourney) => void;
}) {
  const { t } = useTranslation(["ferry"]);
  const formId = useId();
  const [opened] = useState(() => initial(journey));
  const [fields, setFields] = useState(opened);
  const [dep, setDep] = useState(() => port(journey, "dep"));
  const [arr, setArr] = useState(() => port(journey, "arr"));
  const [cancelled, setCancelled] = useState(journey?.status === "cancelled");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [badDep, setBadDep] = useState(false);
  const [badArr, setBadArr] = useState(false);
  useEffect(() => {
    let live = true;
    void tripsApi
      .getAll()
      .then((rows) => {
        if (live) setTrips(rows);
      })
      .catch(() => {
        if (live) setError(t("ferry:error"));
      });
    return () => {
      live = false;
    };
  }, [t]);
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(opened) ||
    JSON.stringify(dep) !== JSON.stringify(port(journey, "dep")) ||
    JSON.stringify(arr) !== JSON.stringify(port(journey, "arr")) ||
    cancelled !== (journey?.status === "cancelled");
  const complete =
    !!dep.name.trim() &&
    dep.lat !== null &&
    dep.lon !== null &&
    !!arr.name.trim() &&
    arr.lat !== null &&
    arr.lon !== null &&
    !!fields.departureLocal &&
    !badDep &&
    !badArr;
  const set = (key: string, value: string) => {
    setFields((old) => ({ ...old, [key]: value }));
    setError(null);
  };
  const save = async () => {
    if (savingRef.current || !complete) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const input: Record<string, unknown> = {
      departureStation: dep,
      arrivalStation: arr,
      departureLocal: fields.departureLocal,
      arrivalLocal: fields.arrivalLocal || null,
      tripId: fields.tripId || null,
      companions: fields.companions
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      status: cancelled ? "cancelled" : "scheduled",
    };
    for (const key of TEXT) input[key] = fields[key].trim() || null;
    for (const key of NUMBERS) input[key] = fields[key] === "" ? null : Number(fields[key]);
    for (const key of ["departureFold", "arrivalFold"]) if (fields[key]) input[key] = fields[key];
    if (journey && JSON.stringify(dep) === JSON.stringify(port(journey, "dep")))
      delete input.departureStation;
    if (journey && JSON.stringify(arr) === JSON.stringify(port(journey, "arr")))
      delete input.arrivalStation;
    // Preserve unedited date-only and DST-fold readings instead of inventing a minute or changing an instant.
    if (journey && fields.departureLocal === opened.departureLocal) delete input.departureLocal;
    if (journey && fields.arrivalLocal === opened.arrivalLocal) delete input.arrivalLocal;
    try {
      const saved = await ferryApi.save(journey?.id ?? null, input);
      onSaved(saved);
    } catch {
      setError(t("ferry:saveError"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const field = (key: string) => (
    <label key={key} className="block text-sm">
      {t(`ferry:${key}`)}
      {key === "departureLocal" || key === "currency" ? " *" : ""}
      {key === "notes" ? (
        <textarea
          className={INPUT}
          rows={3}
          value={fields[key]}
          onChange={(e) => set(key, e.target.value)}
        />
      ) : (
        <input
          className={INPUT}
          value={fields[key]}
          required={key === "departureLocal" || key === "currency"}
          type={
            key.endsWith("Local")
              ? fields[key].length === 10
                ? "date"
                : "datetime-local"
              : (NUMBERS as readonly string[]).includes(key)
                ? "number"
                : "text"
          }
          min={
            (NUMBERS as readonly string[]).includes(key)
              ? key === "price"
                ? 0
                : key === "passengerCount"
                  ? 1
                  : 0.01
              : undefined
          }
          step={key === "passengerCount" ? 1 : "any"}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t(journey ? "ferry:edit" : "ferry:add")}
      dirty={dirty}
      busy={saving}
      maxWidth={760}
      footer={(requestClose) => (
        <>
          {!complete && (
            <p className="mr-auto self-center text-sm text-(--text-muted)">{t("ferry:required")}</p>
          )}
          <Button type="button" variant="secondary" onClick={requestClose} disabled={saving}>
            {t("ferry:cancel")}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!complete || saving}>
            {t("ferry:save")}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && (
          <p
            role="alert"
            className="rounded-md border border-(--danger)/50 bg-(--danger)/10 p-3 text-sm text-(--danger)"
          >
            {error}
          </p>
        )}
        <fieldset className="space-y-4">
          <legend className="t-label-mono mb-3">{t("ferry:sections.route")}</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FerryStationField
              label={t("ferry:departure")}
              idPrefix="ferry-dep"
              value={dep}
              onChange={setDep}
              onValidityChange={(ok) => setBadDep(!ok)}
              required
              inputClassName={INPUT}
            />
            <FerryStationField
              label={t("ferry:arrival")}
              idPrefix="ferry-arr"
              value={arr}
              onChange={setArr}
              onValidityChange={(ok) => setBadArr(!ok)}
              required
              inputClassName={INPUT}
            />
            {field("departureLocal")}
            {field("arrivalLocal")}
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-(--text-muted)">
              {t("ferry:clockChange")}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {["departureFold", "arrivalFold"].map((key) => (
                <label key={key} className="block text-sm">
                  {t(`ferry:${key}`)}
                  <select
                    className={INPUT}
                    value={fields[key]}
                    onChange={(e) => set(key, e.target.value)}
                  >
                    <option value="">{t("ferry:fold.unchanged")}</option>
                    <option value="earlier">{t("ferry:fold.earlier")}</option>
                    <option value="later">{t("ferry:fold.later")}</option>
                  </select>
                </label>
              ))}
            </div>
          </details>
          {field("distanceKm")}
        </fieldset>
        <fieldset>
          <legend className="t-label-mono mb-3">{t("ferry:sections.booking")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "operator",
              "vesselName",
              "bookingReference",
              "ticketReference",
              "passengerCount",
              "cabinType",
              "seat",
              "price",
              "currency",
            ].map(field)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="t-label-mono mb-3">{t("ferry:sections.vehicle")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "vehicleType",
              "vehicleRegistration",
              "vehicleLengthM",
              "vehicleWidthM",
              "vehicleHeightM",
            ].map(field)}
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="t-label-mono mb-3">{t("ferry:sections.trip")}</legend>
          <label className="block text-sm">
            {t("ferry:trip")}
            <select
              className={INPUT}
              value={fields.tripId}
              onChange={(e) => set("tripId", e.target.value)}
              disabled={!!journey?.roadtripLegId}
            >
              <option value="">{t("ferry:noTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </label>
          {journey?.roadtripLegId && <p className="t-caption">{t("ferry:roadtrip.tripLocked")}</p>}
          {field("companions")}
          {field("notes")}
          <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)">
            <input
              type="checkbox"
              checked={cancelled}
              onChange={(e) => setCancelled(e.target.checked)}
            />
            {t("ferry:cancelled")}
          </label>
        </fieldset>
        <RequiredLegend />
      </form>
    </Modal>
  );
}
