/**
 * SpecialFlightModal
 *
 * Entry + edit flow for "Sonder-Flug" (non-scheduled) flights.
 * Supports three kinds:
 *
 *   1) Sightseeing — local loop, airport dep = arr.
 *   2) Event flight — eclipse / rocket launch / aurora chase with
 *      event coordinates + label.
 *   3) ZeroG — parabolic flight, airport dep = arr, pattern center
 *      + parabola count + provider stored in specialData.
 *
 * Phase 2 shipped the create-only flow; Phase 3 added edit mode — when
 * `flight` is non-null, fields are prefilled and Save calls
 * `flightsApi.update` instead of `.create`.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { Flight, FlightInput } from "../types";
import type { Airport } from "../lib/api";
import { flightsApi } from "../lib/api/flights";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import { flightArrival, flightDeparture } from "../lib/entityTimes";
import { datetimeLocalOf, shiftWallClock } from "../lib/wallClockMath";
import { apiErrorMachineCode } from "../lib/apiError";
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import Modal from "./Modal";
import {
  FormErrorBanner,
  RequiredLegend,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
} from "./form";
import { focusFirstMissingRequired } from "./FlightForm/requiredFields";
import { FLIGHT_FORM_TOUCH } from "./FlightForm/formTouch";
import {
  SPECIAL_SERVER_FIELDS,
  specialFlightFieldErrors,
  specialFlightGaps,
} from "./specialFlights/specialFlightRules";
import {
  CommonTimeAndMetaFields,
  EventFields,
  SightseeingFields,
  TypePicker,
  ZEROG_PROVIDERS,
  ZEROG_PROVIDER_OTHER,
  ZeroGFields,
  type EventSubtype,
  type SpecialKind,
} from "./SpecialFlightModalFields";

interface SpecialFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When non-null, modal runs in edit mode. */
  flight?: Flight | null;
}

const csvToArray = (v: string): string[] =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Map a Flight.specialType value onto one of the three UI "kinds".
 * Types outside the modal's current UI surface (training / ferry / test)
 * still need *some* home so the edit modal can load them — map them to
 * "sightseeing" as the most generic single-airport kind.
 */
function classifySpecialType(t: string | null | undefined): SpecialKind | null {
  if (!t) return null;
  if (t === "eclipse" || t === "rocket_launch" || t === "aurora") return "event";
  if (t === "zerog") return "zerog";
  return "sightseeing";
}

function classifyEventSubtype(t: string | null | undefined): EventSubtype {
  if (t === "rocket_launch") return "rocket_launch";
  if (t === "aurora") return "aurora";
  if (t === "eclipse") return "eclipse";
  return "other";
}

/** Re-hydrate an Airport from a Flight's departure / arrival columns. */
function airportFromFlight(flight: Flight, which: "departure" | "arrival"): Airport | null {
  if (which === "departure") {
    if (flight.depLat == null || flight.depLon == null) return null;
    // `Airport.name` is required by the API type. The flight table has
    // it nullable (hence `?: string`) — so we fall back to the airport
    // code or empty string rather than leaking `undefined` into the API.
    return {
      icao: flight.depIcao,
      iata: flight.depIata,
      name: flight.depName ?? flight.depIata ?? flight.depIcao ?? "",
      lat: flight.depLat,
      lon: flight.depLon,
    };
  }
  if (flight.arrLat == null || flight.arrLon == null) return null;
  return {
    icao: flight.arrIcao,
    iata: flight.arrIata,
    name: flight.arrName ?? flight.arrIata ?? flight.arrIcao ?? "",
    lat: flight.arrLat,
    lon: flight.arrLon,
  };
}

export default function SpecialFlightModal({
  isOpen,
  onClose,
  onSaved,
  flight,
}: SpecialFlightModalProps): JSX.Element | null {
  const { t } = useTranslation(["specialFlights", "common", "errors"]);

  const isEditMode = !!flight;

  const [kind, setKind] = useState<SpecialKind | null>(null);
  const [loading, setLoading] = useState(false);
  // Which opening the fields were filled for — the discard guard takes its
  // baseline only once they are (forgejo#248).
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);

  // Shared fields
  const [departureAirport, setDepartureAirport] = useState<Airport | null>(null);
  const [arrivalAirport, setArrivalAirport] = useState<Airport | null>(null);
  const [departureTime, setDepartureTime] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [companions, setCompanions] = useState<string[]>([]);

  // Sightseeing-only
  const [aircraft, setAircraft] = useState("");

  // Event-only
  const [eventSubtype, setEventSubtype] = useState<EventSubtype>("eclipse");
  const [eventLat, setEventLat] = useState<string>("");
  const [eventLon, setEventLon] = useState<string>("");
  const [eventLabel, setEventLabel] = useState<string>("");

  // ZeroG-only
  const [patternLat, setPatternLat] = useState<string>("");
  const [patternLon, setPatternLon] = useState<string>("");
  const [parabolas, setParabolas] = useState<number>(15);
  const [providerPick, setProviderPick] = useState<string>(ZEROG_PROVIDERS[0]);
  const [providerOther, setProviderOther] = useState<string>("");

  // Prefill from flight when entering edit mode. Only runs when the flight
  // identity or open-state actually changes — editing the same flight
  // twice in a row still re-seeds fields.
  useEffect(() => {
    if (!isOpen) return;
    if (!flight) {
      setPrefilledFor("new");
      return;
    }
    setPrefilledFor(flight.id);
    const k = classifySpecialType(flight.specialType);
    setKind(k);
    setDepartureAirport(airportFromFlight(flight, "departure"));
    setArrivalAirport(airportFromFlight(flight, "arrival"));
    // The airports' clocks (`times`), not the browser's — lib/wallClockMath.ts.
    setDepartureTime(datetimeLocalOf(flightDeparture(flight)));
    setArrivalTime(datetimeLocalOf(flightArrival(flight)));
    setNotes(flight.notes ?? "");
    setTagsCsv((flight.tags ?? []).join(", "));
    setCompanions(flight.companions ?? []);
    setAircraft(flight.aircraft ?? "");
    setEventSubtype(classifyEventSubtype(flight.specialType));
    setEventLat(flight.eventLat != null ? String(flight.eventLat) : "");
    setEventLon(flight.eventLon != null ? String(flight.eventLon) : "");
    setEventLabel(flight.eventLabel ?? "");
    setPatternLat(flight.patternLat != null ? String(flight.patternLat) : "");
    setPatternLon(flight.patternLon != null ? String(flight.patternLon) : "");
    const data = flight.specialData ?? null;
    const parab = data && typeof data === "object" ? data["parabolas"] : undefined;
    const prov = data && typeof data === "object" ? data["provider"] : undefined;
    setParabolas(typeof parab === "number" ? Math.round(parab) : 15);
    if (typeof prov === "string" && prov.length > 0) {
      if ((ZEROG_PROVIDERS as readonly string[]).includes(prov)) {
        setProviderPick(prov);
        setProviderOther("");
      } else {
        setProviderPick(ZEROG_PROVIDER_OTHER);
        setProviderOther(prov);
      }
    } else {
      setProviderPick(ZEROG_PROVIDERS[0]);
      setProviderOther("");
    }
  }, [flight, isOpen]);

  // The user-visible, saved fields (forgejo#248).
  const snapshot = {
    kind,
    departure: departureAirport?.icao ?? departureAirport?.iata ?? "",
    arrival: arrivalAirport?.icao ?? arrivalAirport?.iata ?? "",
    departureTime,
    arrivalTime,
    notes,
    tagsCsv,
    companions,
    aircraft,
    eventSubtype,
    eventLat,
    eventLon,
    eventLabel,
    patternLat,
    patternLon,
    parabolas,
    providerPick,
    providerOther,
  };
  const settled = isOpen && prefilledFor === (flight ? flight.id : "new");
  const { dirty } = useDirtyGuard(snapshot, snapshot, { open: settled });

  /**
   * Pattern: "enabled save, a refused click focuses the first gap" — the
   * flight forms' (forgejo#245). The rules are per field (specialFlightRules):
   * shown from the first attempt on, then live; what is missing is listed
   * beside the save.
   */
  const formId = useId();
  const hintId = `${formId}-blocked`;
  const failure = useFormFailure(JSON.stringify(snapshot));
  const [serverField, setServerField] = useState<string | null>(null);
  const fieldErrors = specialFlightFieldErrors(
    { kind, departureAirport, eventLat, eventLon, patternLat, patternLon },
    t
  );
  const missing = specialFlightGaps(fieldErrors, t);
  const serverInput =
    failure.failureKey && serverField ? SPECIAL_SERVER_FIELDS[serverField] : undefined;
  const shownErrors = {
    ...(failure.attempted ? fieldErrors : {}),
    ...(serverInput ? { [serverInput]: t(failure.failureKey!) } : {}),
  };
  const inFlight = useRef(false);

  const resetAll = (): void => {
    setKind(null);
    setDepartureAirport(null);
    setArrivalAirport(null);
    setDepartureTime("");
    setArrivalTime("");
    setNotes("");
    setTagsCsv("");
    setCompanions([]);
    setAircraft("");
    setEventSubtype("eclipse");
    setEventLat("");
    setEventLon("");
    setEventLabel("");
    setPatternLat("");
    setPatternLon("");
    setParabolas(15);
    setProviderPick(ZEROG_PROVIDERS[0]);
    setProviderOther("");
    setPrefilledFor(null);
    failure.clear();
  };

  const handleClose = (): void => {
    resetAll();
    onClose();
  };

  const backToTypeSelector = (): void => {
    setKind(null);
    failure.clear();
  };

  const orUndef = (s: string): string | undefined => (s ? s : undefined);

  // Typical duration in minutes per special-flight kind. Used to auto-fill
  // arrival when the user only provided departureLocal. Loosely based on
  // real-world averages: sightseeing loops ~1h, event flights ~2h, ZeroG
  // parabolic campaigns ~1.5h.
  const defaultDurationMinutes = (k: SpecialKind | null): number => {
    if (k === "sightseeing") return 60;
    if (k === "event") return 120;
    if (k === "zerog") return 90;
    return 60;
  };

  // Add `+minutes` to a "YYYY-MM-DDTHH:mm" wall-clock string, returning the
  // same shape. Tz-naive — purely arithmetic on the local clock, which is
  // exactly what the canonical-UTC submit contract wants for arrivalLocal.
  const addMinutesToLocal = (local: string, minutes: number): string => {
    const shifted = shiftWallClock(local.slice(0, 10), local.slice(11, 16), minutes);
    return shifted ? `${shifted.date}T${shifted.time}` : local;
  };

  // Resolve times into the V2 canonical-UTC submit contract shape: pairs of
  // local wall-clock + IANA timezone. Timezones come from the picked
  // airports. The backend rejects non-historical flights without a valid
  // duration, so:
  //  - both empty → flip status to "historical" so the refine allows nulls.
  //  - departure set, arrival empty → estimate arrival = dep + kind-default.
  //  - both set → pass through untouched.
  const resolveTimesAndStatus = (): Pick<
    FlightInput,
    "departureLocal" | "depTimezone" | "arrivalLocal" | "arrTimezone" | "status"
  > => {
    const dep = orUndef(departureTime);
    const arr = orUndef(arrivalTime);
    const depTz = departureAirport?.timezone ?? undefined;
    const arrTz = arrivalAirport?.timezone ?? departureAirport?.timezone ?? undefined;
    const baseStatus = flight?.status ?? "scheduled";

    if (!dep && !arr) {
      return {
        departureLocal: undefined,
        depTimezone: undefined,
        arrivalLocal: undefined,
        arrTimezone: undefined,
        status: "historical",
      };
    }
    if (dep && !arr) {
      const estArr = addMinutesToLocal(dep, defaultDurationMinutes(kind));
      return {
        departureLocal: dep,
        depTimezone: depTz,
        arrivalLocal: estArr,
        arrTimezone: arrTz,
        status: baseStatus,
      };
    }
    return {
      departureLocal: dep,
      depTimezone: depTz,
      arrivalLocal: arr,
      arrTimezone: arrTz,
      status: baseStatus,
    };
  };

  const baseSharedFields = (): Pick<
    FlightInput,
    | "departureLocal"
    | "depTimezone"
    | "arrivalLocal"
    | "arrTimezone"
    | "notes"
    | "tags"
    | "companions"
    | "status"
  > => ({
    ...resolveTimesAndStatus(),
    // This builder feeds BOTH create and update. null (not undefined) for a
    // blanked field, and always-real arrays: on update, undefined means
    // "keep the old value" server-side, which made clearing the notes, the
    // tags or the last companion a silent no-op in edit mode.
    notes: notes.trim() || null,
    tags: tagsCsv ? csvToArray(tagsCsv) : [],
    companions,
  });

  // The builders run only after the field rules passed (handleSubmit).
  const buildSightseeingInput = (): FlightInput | null => {
    if (!departureAirport) return null;
    return {
      ...baseSharedFields(),
      specialType: "sightseeing",
      departure: departureAirport,
      arrival: departureAirport,
      aircraft: aircraft.trim() || null,
    };
  };

  const eventSubtypeToSpecialType = (sub: EventSubtype): FlightInput["specialType"] => {
    // "other" falls back to "sightseeing" — it's not a strict eclipse/rocket/aurora but
    // still a special non-scheduled flight driven by an external event. Documenting here:
    // backend accepts the full 8-value enum, "other" just isn't one of them.
    switch (sub) {
      case "eclipse":
        return "eclipse";
      case "rocket_launch":
        return "rocket_launch";
      case "aurora":
        return "aurora";
      case "other":
        return "sightseeing";
    }
  };

  const buildEventInput = (): FlightInput | null => {
    if (!departureAirport) return null;
    const latNum = Number(eventLat);
    const lonNum = Number(eventLon);
    return {
      ...baseSharedFields(),
      specialType: eventSubtypeToSpecialType(eventSubtype),
      departure: departureAirport,
      arrival: arrivalAirport ?? departureAirport,
      eventLat: eventLat === "" ? null : latNum,
      eventLon: eventLon === "" ? null : lonNum,
      eventLabel: eventLabel.trim() || null,
    };
  };

  const buildZeroGInput = (): FlightInput | null => {
    if (!departureAirport) return null;
    const latNum = Number(patternLat);
    const lonNum = Number(patternLon);
    const providerName =
      providerPick === ZEROG_PROVIDER_OTHER ? providerOther.trim() : providerPick;
    return {
      ...baseSharedFields(),
      specialType: "zerog",
      departure: departureAirport,
      arrival: departureAirport,
      patternLat: patternLat === "" ? undefined : latNum,
      patternLon: patternLon === "" ? undefined : lonNum,
      specialData: {
        parabolas: Number(parabolas),
        provider: providerName,
      },
    };
  };

  const handleSubmit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    failure.markAttempted();
    if (missing.length > 0) {
      // The airport first (a required field), else the first invalid
      // coordinate, whose error renders with this click.
      if (!focusFirstMissingRequired(failure.rootRef.current)) failure.focusFirstProblem();
      return;
    }

    let input: FlightInput | null = null;
    if (kind === "sightseeing") input = buildSightseeingInput();
    else if (kind === "event") input = buildEventInput();
    else if (kind === "zerog") input = buildZeroGInput();

    if (!input) return;

    // When the kind changes during edit (e.g. user picks a different
    // special-type picker chip), null out the fields the new kind
    // doesn't own so they don't stick around in the DB. Each
    // `build*Input` helper only sets the fields relevant to its kind,
    // so we normalise here before hitting the API.
    if (isEditMode && flight) {
      const normalized: FlightInput = { ...input };
      if (kind !== "event") {
        normalized.eventLat = null;
        normalized.eventLon = null;
        normalized.eventLabel = null;
      }
      if (kind !== "zerog") {
        normalized.patternLat = null;
        normalized.patternLon = null;
        normalized.specialData = null;
      }
      input = normalized;
    }

    // One request at a time: Enter and a click in the same frame both saw
    // `loading === false`, and a create went out twice.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setLoading(true);
      if (isEditMode && flight) {
        await flightsApi.update(flight.id, input);
      } else {
        await flightsApi.create(input);
      }
    } catch (err) {
      logger.error("Failed to save special flight:", err);
      const data = (err as { response?: { data?: { field?: unknown } } } | null)?.response?.data;
      setServerField(
        apiErrorMachineCode(err) && typeof data?.field === "string" ? data.field : null
      );
      failure.fail(saveErrorKey(err, "specialFlights:error.saveFailed"));
      return;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
    // Stored. What follows (the caller's toast and reload) is synchronous;
    // the dialog closes either way, so nothing here can send it again.
    resetAll();
    onSaved();
    onClose();
  };

  // On the shared frame since forgejo#248: it was a hand-rolled overlay with
  // no dialog role, no Escape, no focus trap and no focus return — and it is
  // what now asks before a changed form is discarded.
  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      busy={loading}
      dirty={settled && dirty}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      title={
        <span className="flex flex-col">
          <span>
            {isEditMode ? t("specialFlights:modal.editTitle") : t("specialFlights:modal.title")}
          </span>
          <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>
            {kind === null
              ? t("specialFlights:step.pick_type")
              : t("specialFlights:modal.subtitle")}
          </span>
        </span>
      }
      footer={(requestClose) => (
        <>
          {kind !== null && (
            <div className="mr-auto self-center">
              <SaveBlockedHint id={hintId} missing={missing} />
            </div>
          )}
          <button type="button" onClick={requestClose} className="btn-secondary" disabled={loading}>
            {t("specialFlights:actions.cancel")}
          </button>
          {kind !== null && (
            <button
              type="submit"
              form={formId}
              disabled={loading}
              className="btn-primary"
              aria-describedby={hintId}
            >
              {loading ? t("specialFlights:actions.saving") : t("specialFlights:actions.save")}
            </button>
          )}
        </>
      )}
    >
      <div ref={failure.rootRef} className="space-y-4">
        <FormErrorBanner
          message={failure.failureKey && !serverInput ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey && isTransientSaveError(failure.failureKey)
              ? () => void handleSubmit()
              : undefined
          }
          retryDisabled={loading}
        />

        {kind === null ? (
          <TypePicker onPick={(k) => setKind(k)} />
        ) : (
          <form
            id={formId}
            // The form's own rules decide (at the field, focused); the
            // browser's bubble would refuse an out-of-range number first and
            // say it in its own words, in the browser's language.
            noValidate
            onSubmit={(e) => void handleSubmit(e)}
            className={`space-y-5 ${FLIGHT_FORM_TOUCH}`}
          >
            <button
              type="button"
              onClick={backToTypeSelector}
              className="text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
              style={{ color: "var(--accent)" }}
            >
              {t("specialFlights:step.back")}
            </button>

            {kind === "sightseeing" && (
              <SightseeingFields
                errors={shownErrors}
                airport={departureAirport}
                onAirportChange={setDepartureAirport}
                aircraft={aircraft}
                onAircraftChange={setAircraft}
              />
            )}

            {kind === "event" && (
              <EventFields
                errors={shownErrors}
                subtype={eventSubtype}
                onSubtypeChange={setEventSubtype}
                departureAirport={departureAirport}
                onDepartureAirportChange={setDepartureAirport}
                arrivalAirport={arrivalAirport}
                onArrivalAirportChange={setArrivalAirport}
                eventLat={eventLat}
                onEventLatChange={setEventLat}
                eventLon={eventLon}
                onEventLonChange={setEventLon}
                eventLabel={eventLabel}
                onEventLabelChange={setEventLabel}
              />
            )}

            {kind === "zerog" && (
              <ZeroGFields
                errors={shownErrors}
                airport={departureAirport}
                onAirportChange={setDepartureAirport}
                patternLat={patternLat}
                onPatternLatChange={setPatternLat}
                patternLon={patternLon}
                onPatternLonChange={setPatternLon}
                parabolas={parabolas}
                onParabolasChange={setParabolas}
                providerPick={providerPick}
                onProviderPickChange={setProviderPick}
                providerOther={providerOther}
                onProviderOtherChange={setProviderOther}
              />
            )}

            <CommonTimeAndMetaFields
              errors={shownErrors}
              departureTime={departureTime}
              onDepartureTimeChange={setDepartureTime}
              arrivalTime={arrivalTime}
              onArrivalTimeChange={setArrivalTime}
              notes={notes}
              onNotesChange={setNotes}
              tagsCsv={tagsCsv}
              onTagsCsvChange={setTagsCsv}
              companions={companions}
              onCompanionsChange={setCompanions}
            />

            <RequiredLegend />
          </form>
        )}
      </div>
    </Modal>
  );
}
