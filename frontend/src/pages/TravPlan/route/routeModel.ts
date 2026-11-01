/** Pure helpers of the route-plan screens (spec §5.8). No React, no clock besides the argument. */
import { newPlanId } from "../../../lib/travplanId";
import type {
  PlanBooking,
  PlanPlace,
  PlanStage,
  PlanState,
  PlanStation,
  RouteSchedule,
} from "../../../lib/api/travplan";

/** How a stage or a night stands, which decides its styling (board 7). */
export type RouteTone = "booked" | "placeholder" | "own" | "spontaneous" | "undecided" | "idea";

const OPEN_MODES: PlanStage["mode"][] = ["ferry", "rail", "flight"];

export function stageTone(stage: PlanStage, bookings: PlanBooking[]): RouteTone {
  const booking = stage.bookingId ? bookings.find((b) => b.id === stage.bookingId) : undefined;
  if (booking) return booking.placeholder ? "placeholder" : "booked";
  return OPEN_MODES.includes(stage.mode) ? "undecided" : "own";
}

export function nightTone(station: PlanStation, bookings: PlanBooking[]): RouteTone {
  const night = station.night;
  if (night.kind === "booked") {
    const booking = bookings.find((b) => b.id === night.bookingId);
    return booking?.placeholder ? "placeholder" : "booked";
  }
  if (night.kind === "idea") return night.candidates.length ? "idea" : "undecided";
  if (night.kind === "onboard") return "booked";
  return night.kind === "pitch" ? "own" : "spontaneous";
}

export function newStation(place: PlanPlace, nights = 1): PlanStation {
  return {
    id: newPlanId(),
    title: place.name,
    place,
    nights,
    pinnedDay: null,
    night: { kind: "spontaneous" },
    note: "",
  };
}

export function newStage(fromStationId: string, toStationId: string): PlanStage {
  return {
    id: newPlanId(),
    fromStationId,
    toStationId,
    mode: "drive",
    departDay: null,
    departTime: null,
    durationMinutes: null,
    distanceKm: null,
    metricsSource: null,
    fallbackReason: null,
    bookingId: null,
    overnight: false,
    note: "",
  };
}

/** The stage that joins two consecutive stations, if the plan has one. */
export function stageBetween(state: PlanState, from: PlanStation, to: PlanStation) {
  return state.stages.find((g) => g.fromStationId === from.id && g.toStationId === to.id);
}

export interface RouteTotals {
  stations: number;
  nights: number;
  /** null when no stage has a distance: unknown is not 0. */
  km: number | null;
  minutes: number | null;
  /** Stages between consecutive stations that still lack figures. */
  unmeasured: number;
}

export function routeTotals(state: PlanState): RouteTotals {
  let km = 0,
    minutes = 0,
    measuredKm = 0,
    measuredMin = 0,
    unmeasured = 0;
  state.stations.slice(1).forEach((to, i) => {
    const stage = stageBetween(state, state.stations[i], to);
    if (!stage || stage.mode !== "drive") return;
    if (stage.distanceKm === null) unmeasured++;
    else {
      km += stage.distanceKm;
      measuredKm++;
    }
    if (stage.durationMinutes !== null) {
      minutes += stage.durationMinutes;
      measuredMin++;
    }
  });
  return {
    stations: state.stations.length,
    nights: state.stations.reduce((n, s) => n + s.nights, 0),
    km: measuredKm ? Math.round(km) : null,
    minutes: measuredMin ? minutes : null,
    unmeasured,
  };
}

export function stationDays(schedule: RouteSchedule | undefined, stationId: string) {
  const row = schedule?.stations.find((s) => s.stationId === stationId);
  return { arrive: row?.arriveDay ?? null, depart: row?.departDay ?? null };
}

/** `5 h 30 min`, `45 min`, null stays null. */
export function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** A station can be handed over once its arrival day is today or earlier and the plan is a route. */
export function canHandOver(
  state: PlanState,
  stationId: string,
  schedule: RouteSchedule | undefined,
  today: string
): boolean {
  if (state.shape !== "route") return false;
  const { arrive } = stationDays(schedule, stationId);
  return !!arrive && arrive <= today;
}

export const linkOf = (state: PlanState, stationId: string) =>
  state.stationLinks.find((l) => l.stationId === stationId);

/** Whether the plan itself wrote something for the station, so that withdrawing means anything. */
export const wroteRecords = (state: PlanState, stationId: string) =>
  (linkOf(state, stationId)?.created.length ?? 0) > 0;

/** Day trips of a station: items anchored to it. */
export const dayTripsOf = (state: PlanState, stationId: string) =>
  state.items.filter((i) => i.stationId === stationId);
