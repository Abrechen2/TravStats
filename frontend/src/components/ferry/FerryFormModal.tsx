import { parseDecimalInput } from "../../lib/decimalInput";
import { useEffect, useId, useRef, useState } from "react";
import { FerryTicketImport } from "./FerryTicketImport";
import Modal from "../Modal";
import RequiredLegend from "../form/RequiredLegend";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { ferryApi, type FerryJourneyInput } from "../../lib/api/ferry";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { useToastStore } from "../../store/toastStore";
import { tripsApi } from "../../lib/api";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import type { FerryJourney } from "../../types/ferry";
import type { Trip } from "../../types";
import { FerryStationField, EMPTY_TERMINAL, type FerryStationDraft } from "./FerryStationField";

const TEXT = [
  "operator",
  "vesselName",
  "vesselMmsi",
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
/** Typed in either notation ("39,90", "1.500,00") — see `parseDecimalInput`. */
const DECIMALS: readonly string[] = NUMBERS.filter((key) => key !== "passengerCount");
/**
 * Each number field as the write body takes it, or the first field that is
 * not a number. `Number("39,90")` was NaN, which JSON sends as null, so a
 * German price, length or distance was silently cleared on save.
 */
function readNumbers(
  fields: Record<string, string>
): { values: Record<string, number | null> } | { invalid: string } {
  const values: Record<string, number | null> = {};
  for (const key of NUMBERS) {
    const n = DECIMALS.includes(key)
      ? parseDecimalInput(fields[key])
      : fields[key].trim() === ""
        ? null
        : Number(fields[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { invalid: key };
    values[key] = n;
  }
  return { values };
}
/**
 * Why a ferry save failed, in the reader's language: the shared reasons (a
 * clock-change gap, a dropped connection, a rate limit, an unknown outcome on
 * create) plus the two 409s only this editor meets (forgejo#376).
 */
function ferrySaveErrorKey(err: unknown, creating: boolean): string {
  const key = saveErrorKey(
    err,
    "ferry:saveError",
    { VERSION_CONFLICT: "ferry:versionConflict" },
    { create: creating }
  );
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return key === "ferry:saveError" && status === 409 ? "ferry:legLinkedError" : key;
}
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
  // Only a typed distance is shown: a prefilled great-circle figure would be
  // saved back and stored as distanceSource "user", freezing it on every edit.
  if (ride?.distanceSource !== "user") fields.distanceKm = "";
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
  const [ticketDocumentId, setTicketDocumentId] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importDirty, setImportDirty] = useState(false);
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
    importDirty ||
    ticketDocumentId !== null ||
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
  const addToast = useToastStore((s) => s.addToast);
  const save = async () => {
    if (savingRef.current || importBusy || !complete) return;
    if (fields.vesselMmsi.trim() !== "" && !/^\d{9}$/.test(fields.vesselMmsi.trim())) {
      setError(t("ferry:invalidMmsi"));
      return;
    }
    const numbers = readNumbers(fields);
    if ("invalid" in numbers) {
      setError(t("ferry:invalidNumber", { field: t(`ferry:${numbers.invalid}`) }));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const input: FerryJourneyInput = {
      ...(ticketDocumentId ? { documentIds: [ticketDocumentId] } : {}),
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
    Object.assign(input, numbers.values);
    for (const key of ["departureFold", "arrivalFold"] as const)
      if (fields[key]) input[key] = fields[key];
    if (journey && JSON.stringify(dep) === JSON.stringify(port(journey, "dep")))
      delete input.departureStation;
    if (journey && JSON.stringify(arr) === JSON.stringify(port(journey, "arr")))
      delete input.arrivalStation;
    // Preserve unedited date-only and DST-fold readings instead of inventing a minute or changing an instant.
    if (journey && fields.departureLocal === opened.departureLocal) delete input.departureLocal;
    if (journey && fields.arrivalLocal === opened.arrivalLocal) delete input.arrivalLocal;
    try {
      const { ride: saved, seaRoute } = await ferryApi.saveReported(journey?.id ?? null, input);
      // Saved either way; a sea line that did not come is said, not hidden.
      // No sea way at all ("straight") is an answer, not a failure.
      if (seaRoute === "failed") addToast("warning", t("ferry:routing.autoFailed"), 9000);
      onSaved(saved);
    } catch (err: unknown) {
      setError(t(ferrySaveErrorKey(err, journey === null)));
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
              : key === "passengerCount"
                ? "number"
                : "text"
          }
          inputMode={DECIMALS.includes(key) ? "decimal" : undefined}
          min={key === "passengerCount" ? 1 : undefined}
          step={key === "passengerCount" ? 1 : undefined}
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
      busy={saving || importBusy}
      maxWidth={760}
      footer={(requestClose) => (
        <>
          {!complete && (
            <p className="mr-auto self-center text-sm text-(--text-muted)">{t("ferry:required")}</p>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={requestClose}
            disabled={saving || importBusy}
          >
            {t("ferry:cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!complete || saving || importBusy}
          >
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
        {!journey && !imported && (
          <FerryTicketImport
            current={{ ...fields, departurePort: dep.name, arrivalPort: arr.name }}
            onBusyChange={setImportBusy}
            onDirtyChange={setImportDirty}
            onApply={(values, id) => {
              const { departurePort, arrivalPort, ...rest } = values;
              setFields((old) => ({ ...old, ...rest }));
              if (departurePort) setDep({ ...EMPTY_TERMINAL, name: departurePort });
              if (arrivalPort) setArr({ ...EMPTY_TERMINAL, name: arrivalPort });
              setTicketDocumentId(id);
              setImported(true);
            }}
          />
        )}
        {imported && (
          <p role="status" className="t-caption">
            {t("ferry:import.checkPorts")}
          </p>
        )}
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
              "vesselMmsi",
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
