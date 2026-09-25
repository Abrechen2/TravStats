import type { RailJourney, RailJourneyInput, RailTravelClass } from "../../types/rail";
import { toStationWallClock } from "../../lib/railTime";
import { EMPTY_STATION, type RailStationDraft } from "./RailStationField";

/**
 * The rail form's state and its translation to the write body — pure, so the
 * rules (what clears a field, when a distance counts as typed) are testable
 * without rendering a modal.
 */
export interface RailFormDraft {
  operator: string;
  trainCategory: string;
  trainNumber: string;
  departure: RailStationDraft;
  arrival: RailStationDraft;
  departureLocal: string;
  arrivalLocal: string;
  /** Only what the user typed. A measured distance is not shown here. */
  distanceKm: string;
  travelClass: RailTravelClass | "";
  coach: string;
  seat: string;
  delayMinutes: string;
  bookingReference: string;
  price: string;
  currency: string;
  cancelled: boolean;
  tags: string;
  companions: string[];
  tripId: string;
  notes: string;
}

export function draftFrom(journey: RailJourney | null): RailFormDraft {
  if (!journey) {
    return {
      operator: "",
      trainCategory: "",
      trainNumber: "",
      departure: EMPTY_STATION,
      arrival: EMPTY_STATION,
      departureLocal: "",
      arrivalLocal: "",
      distanceKm: "",
      travelClass: "",
      coach: "",
      seat: "",
      delayMinutes: "",
      bookingReference: "",
      price: "",
      currency: "EUR",
      cancelled: false,
      tags: "",
      companions: [],
      tripId: "",
      notes: "",
    };
  }
  return {
    operator: journey.operator ?? "",
    trainCategory: journey.trainCategory ?? "",
    trainNumber: journey.trainNumber ?? "",
    departure: {
      name: journey.depStationName,
      lat: journey.depLat,
      lon: journey.depLon,
      country: journey.depCountry,
    },
    arrival: {
      name: journey.arrStationName,
      lat: journey.arrLat,
      lon: journey.arrLon,
      country: journey.arrCountry,
    },
    // Read back on each station's own clock — the time the ticket printed.
    departureLocal: toStationWallClock(journey.departureTime, journey.depTimezone),
    arrivalLocal: toStationWallClock(journey.arrivalTime, journey.arrTimezone),
    distanceKm:
      journey.distanceSource === "user" && journey.distanceKm !== null
        ? String(journey.distanceKm)
        : "",
    travelClass: journey.travelClass ?? "",
    coach: journey.coach ?? "",
    seat: journey.seat ?? "",
    delayMinutes: journey.delayMinutes === null ? "" : String(journey.delayMinutes),
    bookingReference: journey.bookingReference ?? "",
    price: journey.price === null ? "" : String(journey.price),
    currency: journey.currency ?? "EUR",
    cancelled: journey.status === "cancelled",
    tags: journey.tags.join(", "),
    companions: journey.companions,
    tripId: journey.tripId ?? "",
    notes: journey.notes ?? "",
  };
}

/** A station the server will accept: a name AND a position. */
export function isStationComplete(station: RailStationDraft): boolean {
  return station.name.trim() !== "" && station.lat !== null && station.lon !== null;
}

export function canSubmit(draft: RailFormDraft): boolean {
  return (
    isStationComplete(draft.departure) &&
    isStationComplete(draft.arrival) &&
    draft.departureLocal !== ""
  );
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function stationInput(station: RailStationDraft): RailJourneyInput["departureStation"] {
  if (station.lat === null || station.lon === null) {
    throw new Error("station without a position");
  }
  return {
    name: station.name.trim(),
    lat: station.lat,
    lon: station.lon,
    country: station.country,
  };
}

/**
 * The write body. Every optional field is SENT, as null when empty: omitting
 * it would tell the server "keep the old value", and blanking a field in the
 * edit form would silently do nothing (the defect the cruise form had).
 */
export function toRailInput(draft: RailFormDraft): RailJourneyInput {
  return {
    operator: orNull(draft.operator),
    trainCategory: orNull(draft.trainCategory),
    trainNumber: orNull(draft.trainNumber),
    departureStation: stationInput(draft.departure),
    arrivalStation: stationInput(draft.arrival),
    departureLocal: draft.departureLocal,
    arrivalLocal: draft.arrivalLocal === "" ? null : draft.arrivalLocal,
    distanceKm: numberOrNull(draft.distanceKm),
    travelClass: draft.travelClass === "" ? null : draft.travelClass,
    coach: orNull(draft.coach),
    seat: orNull(draft.seat),
    delayMinutes: (() => {
      const n = numberOrNull(draft.delayMinutes);
      return n === null ? null : Math.round(n);
    })(),
    bookingReference: orNull(draft.bookingReference),
    price: numberOrNull(draft.price),
    currency: draft.currency || "EUR",
    status: draft.cancelled ? "cancelled" : "scheduled",
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
    companions: draft.companions,
    tripId: draft.tripId === "" ? null : draft.tripId,
    notes: orNull(draft.notes),
  };
}
