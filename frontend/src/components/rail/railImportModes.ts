import type { BusJourneyInput, BusRideKind } from "../../types/bus";
import type { RailImportBooking, RailImportLeg, RailTransitMode } from "../../types/rail";
import type { RailStationDraft } from "./RailStationField";

/**
 * The legs of a bahn.de connection that are no train (2026-10-23): a U-Bahn,
 * a tram, a bus, a ferry. A tester deleted them by hand on every import; now
 * each leg says what it is and starts the way the account asked:
 *
 * - a train — and a leg nothing classifies — starts ticked, as before;
 * - a U-Bahn or tram leg starts unticked, or ticked as a rail journey of that
 *   mode when the account remembered so; it is stored but counts in no rail
 *   figure (`shared/railCounting.ts`);
 * - a bus leg — city bus, replacement bus, Fernbus — starts unticked, or ticked
 *   as a bus ride when the account remembered so AND has the bus domain; with
 *   the domain off it can only be skipped, never turned into a train;
 * - a ferry can only be skipped here.
 *
 * A document's legs carry no `transit` and are trains.
 */

export interface RailImportDefaults {
  localTransit: "skip" | "rail";
  bus: "skip" | "bus";
  /** Whether the account has the bus domain switched on. */
  busEnabled: boolean;
}

export const NO_LOCAL_TRANSIT: RailImportDefaults = {
  localTransit: "skip",
  bus: "skip",
  busEnabled: false,
};

/** The two groups an account remembers a default for. */
export type LocalTransitGroup = "localTransit" | "bus";

export function groupOf(leg: RailImportLeg): LocalTransitGroup | null {
  const mode = leg.transit?.mode;
  if (mode === "metro" || mode === "tram") return "localTransit";
  if (mode === "bus") return "bus";
  return null;
}

/** How a leg starts: ticked or not, and what it would be saved as. */
export function legStart(
  leg: RailImportLeg,
  defaults: RailImportDefaults
): { selected: boolean; saveAs: "rail" | "bus" | null } {
  const fresh = leg.duplicateOf === null;
  const mode = leg.transit?.mode;
  if (mode === "ferry") return { selected: false, saveAs: null };
  const group = groupOf(leg);
  if (group === "localTransit") {
    return { selected: fresh && defaults.localTransit === "rail", saveAs: "rail" };
  }
  if (group === "bus") {
    if (!defaults.busEnabled) return { selected: false, saveAs: null };
    return { selected: fresh && defaults.bus === "bus", saveAs: "bus" };
  }
  return { selected: fresh, saveAs: "rail" };
}

/** The mode a leg saved as a rail journey is stored with. */
export function railTransitModeOf(leg: RailImportLeg): RailTransitMode {
  const mode = leg.transit?.mode;
  return mode === "metro" || mode === "tram" ? mode : "rail";
}

/** The i18n key of a leg's mode label, or null for a document's leg (it says nothing). */
export function modeLabelKey(leg: RailImportLeg): string | null {
  const transit = leg.transit;
  if (!transit) return null;
  if (transit.mode === "bus") return `rail:import.mode.bus.${transit.busKind ?? "city"}`;
  return `rail:import.mode.${transit.mode}`;
}

/**
 * What „als Standard merken“ would store for a group: every leg of it ticked,
 * or none. Null when the legs disagree — remembering would then be a guess —
 * or when the booking has none of the group.
 */
export function groupChoice(
  rows: readonly { leg: RailImportLeg; selected: boolean }[],
  group: LocalTransitGroup
): "skip" | "rail" | "bus" | null {
  const members = rows.filter((r) => groupOf(r.leg) === group);
  if (members.length === 0) return null;
  if (members.every((r) => r.selected)) return group === "bus" ? "bus" : "rail";
  if (members.every((r) => !r.selected)) return "skip";
  return null;
}

/** The ride kind of a bus leg: a coach is long distance; a city or replacement bus is not. */
function rideKindOf(leg: RailImportLeg): BusRideKind {
  return leg.transit?.busKind === "coach" ? "intercity" : "other";
}

function terminal(s: RailStationDraft): BusJourneyInput["departureStation"] {
  if (s.lat === null || s.lon === null) throw new Error("stop without a position");
  return { name: s.name.trim(), address: null, lat: s.lat, lon: s.lon, country: s.country };
}

/**
 * A bus leg as an ordinary POST /bus body: bahn.de's names and positions, the
 * line as printed ("Bus 100", "SEV"). No operator: the connection names none,
 * and none is invented.
 */
export function toBusInput(
  booking: RailImportBooking,
  row: {
    leg: RailImportLeg;
    departure: RailStationDraft;
    arrival: RailStationDraft;
  }
): BusJourneyInput {
  const line = [row.leg.trainCategory, row.leg.trainNumber].filter(Boolean).join(" ");
  return {
    operator: null,
    lineName: line ? line.slice(0, 40) : null,
    rideKind: rideKindOf(row.leg),
    departureStation: terminal(row.departure),
    arrivalStation: terminal(row.arrival),
    departureLocal: row.leg.departureLocal,
    arrivalLocal: row.leg.arrivalLocal,
    distanceKm: null,
    fareClass: null,
    seat: null,
    delayMinutes: null,
    bookingReference: booking.bookingReference,
    price: null,
    currency: booking.currency ?? "EUR",
    status: "scheduled",
    tags: [],
    companions: [],
    tripId: null,
    notes: null,
  };
}
