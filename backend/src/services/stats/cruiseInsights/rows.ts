/**
 * The cruises the cruise insights (forgejo#257) read, loaded once — for the
 * endpoint, the evidence resolvers and the badges alike, so a figure, the list
 * behind it and the badge it feeds count the same port calls.
 *
 * ## Which cruises
 *
 * The SAILED ones (`shared/cruiseCounting.ts`, the `GET /stats/cruise`
 * population): a booked voyage has called at no port yet. Each row carries
 * the `CruiseData` the existing calculator reads (`loadCruiseStatsData`, so
 * the special events are that calculator's own answer) plus what these
 * insights need beyond it: every stop's id, day, times and excursion note.
 *
 * ## The day of a stop
 *
 * The stop's own local day (`stop_date`, else the legacy day column, read by
 * `cruiseStopTimes`); without either, the cruise's start day plus the stop's
 * `dayNumber` − 1 — `dayNumber` is the day of the cruise (forgejo#126). The
 * departure port is on the start day, the arrival port on the end day.
 */

import { prisma } from "../../../db";
import { countableCruiseWhere } from "../../../shared/cruiseCounting";
import type { TimeValue } from "../../../shared/time/wire";
import type { CruiseData } from "../../../utils/cruiseStats";
import { cruiseStopTimes } from "../../cruise/timesDto";
import { loadCruiseStatsData } from "../cruiseStatsData";

export interface CruiseCall {
  stopId: string;
  dayNumber: number;
  /** `YYYY-MM-DD`, see the module note; null only for an undated cruise without a stop day. */
  day: string | null;
  isAtSea: boolean;
  /** Catalogue port; null for a sea day and for an unresolved port. */
  portId: number | null;
  /** The catalogue name, or the unresolved name as imported; null on a sea day. */
  portName: string | null;
  lat: number | null;
  lon: number | null;
  arrival: TimeValue | null;
  departure: TimeValue | null;
  excursionNote: string | null;
}

export interface CruiseInsightRow {
  id: string;
  label: string;
  startDay: string | null;
  endDay: string | null;
  /** The start's UTC year — the cruise tab's year rule (`startedIn`). */
  year: number | null;
  /** Exactly what `calculateCruiseStats` is handed for this cruise. */
  input: CruiseData;
  /** Every stop, sea days included, in day order. */
  calls: CruiseCall[];
}

export interface CruiseInsightData {
  rows: CruiseInsightRow[];
  userBirthday?: { month: number; day: number };
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export async function loadCruiseInsightData(userId: string): Promise<CruiseInsightData> {
  const { rows, userBirthday } = await loadCruiseStatsData(userId, undefined, "sailed");
  const stops = await prisma.cruiseStop.findMany({
    where: { cruise: { userId, ...countableCruiseWhere() } },
    select: {
      id: true,
      cruiseId: true,
      dayNumber: true,
      isAtSea: true,
      portId: true,
      date: true,
      stopDate: true,
      stopZone: true,
      arrivalTime: true,
      departureTime: true,
      arrivalUtc: true,
      departureUtc: true,
      timePrecision: true,
      excursionNote: true,
      unresolvedPortName: true,
      port: { select: { name: true, lat: true, lon: true } },
    },
    orderBy: [{ dayNumber: "asc" }, { id: "asc" }],
  });
  const byCruise = new Map<string, typeof stops>();
  for (const stop of stops)
    byCruise.set(stop.cruiseId, [...(byCruise.get(stop.cruiseId) ?? []), stop]);

  return {
    userBirthday,
    rows: rows.map((r) => {
      const startDay = dayOf(r.input.startDate);
      const endDay = dayOf(r.input.endDate) ?? startDay;
      const calls = (byCruise.get(r.id) ?? []).map((s): CruiseCall => {
        const times = cruiseStopTimes(s);
        return {
          stopId: s.id,
          dayNumber: s.dayNumber,
          day: times.date?.date ?? (startDay ? addDays(startDay, s.dayNumber - 1) : null),
          isAtSea: s.isAtSea,
          portId: s.isAtSea ? null : s.portId,
          portName: s.isAtSea ? null : (s.port?.name ?? s.unresolvedPortName ?? null),
          lat: s.port?.lat ?? null,
          lon: s.port?.lon ?? null,
          arrival: times.arrival,
          departure: times.departure,
          excursionNote: s.excursionNote?.trim() ? s.excursionNote.trim() : null,
        };
      });
      return {
        id: r.id,
        label: r.label,
        startDay,
        endDay,
        year: r.input.startDate ? r.input.startDate.getUTCFullYear() : null,
        input: r.input,
        calls,
      };
    }),
  };
}
