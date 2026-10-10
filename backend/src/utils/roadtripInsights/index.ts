/**
 * The roadtrip insights (forgejo#260): what has happened against what is
 * today and what is planned, day stages and pace, road against ferry, where
 * the nights were slept, and the day tours along the way. Pure — the loader
 * is `services/stats/insights/roadtripInsightData.ts`.
 *
 * Every figure runs through `shared/tour/roadtripTimeline.ts`, so a leg or a
 * night is "recorded" by one rule only; nights through `countRoadtripNights`
 * (a linked stay's night is the stay's, counted once); countries through the
 * station-country rule the list uses. The badges read THIS module's `awards`
 * (`utils/roadtripAchievements.ts`), which is how next week's ferry stopped
 * reaching them (the extension to #179).
 */
import { dayPrecisionDate } from "../../services/evidence/entryMappersDomains";
import type { MeasureItem, MeasureItems } from "../../services/stats/insights/measureItems";
import { stationCountries } from "../../services/roadtrip/roadtripSummary";
import type { CountryResolver } from "../../services/geo/countryFromCoordinates";
import { countRoadtripNights, isStation, type CountableStation } from "../../shared/tour/roadtrip";
import {
  isRecorded,
  roadtripPhase,
  stationDays,
  stationPhase,
} from "../../shared/tour/roadtripTimeline";
import type { TourFacts } from "../tourInsights/tourFacts";
import { segmentsOf } from "./segments";
import { stretchBucket } from "./progress";
import type {
  DayStage,
  InsightRoadtrip,
  InsightStation,
  RoadtripInsights,
  RoadtripRow,
} from "./types";

export type { InsightRoadtrip, RoadtripInsights } from "./types";

// threshold: proposal forgejo#260, owner to confirm — "Basislager": nights at one station …
export const BASE_CAMP_NIGHTS = 3;
// threshold: proposal forgejo#260, owner to confirm — … and completed day tours from it.
export const BASE_CAMP_TOURS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function countable(s: InsightStation): CountableStation {
  return {
    lodgingStayId: s.lodgingStayId,
    overnight: s.overnight,
    viaPoint: s.viaPoint,
    startDate: s.startDate,
    endDate: s.endDate,
    stay: s.lodgingStay
      ? {
          checkIn: s.lodgingStay.checkIn,
          checkOut: s.lodgingStay.checkOut,
          datePrecision: s.lodgingStay.datePrecision,
          nights: s.lodgingStay.nights,
          status: s.lodgingStay.status,
          lodgingType: s.lodgingStay.lodging.type,
        }
      : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Days of a finished, fully dated roadtrip on which no stage began or ended. */
function restDaysOf(stations: InsightStation[], stageDays: Set<string>): number | null {
  const days = stations.map(stationDays);
  if (days.some((d) => d.first === null)) return null;
  const first = days.map((d) => d.first as string).sort()[0];
  const last = days
    .map((d) => (d.last ?? d.first) as string)
    .sort()
    .reverse()[0];
  let rest = 0;
  for (
    let t = Date.parse(`${first}T00:00:00Z`);
    t <= Date.parse(`${last}T00:00:00Z`);
    t += DAY_MS
  ) {
    if (!stageDays.has(new Date(t).toISOString().slice(0, 10))) rest += 1;
  }
  return rest;
}

interface Context {
  resolver: Pick<CountryResolver, "countryAt">;
  now: Date;
  toursByRoadtrip: Map<string, TourFacts[]>;
}

function rowOf(
  r: InsightRoadtrip,
  ctx: Context,
  stages: DayStage[]
): { row: RoadtripRow; unstaged: number; baseCamps: number } {
  const real = r.stations.filter(isStation);
  const tripPhase = roadtripPhase(real, ctx.now);
  const firstDay = real
    .map((s) => stationDays(s).first)
    .filter((d): d is string => d !== null)
    .sort()[0];

  const km = { recorded: 0, current: 0, planned: 0, unplaced: 0 };
  // Road legs only: the kilometres the vehicle itself drove. A ferry, a train
  // or a walk is reported per mode and never becomes "driven" (forgejo#260).
  const roadKm = { recorded: 0, current: 0, planned: 0, unplaced: 0 };
  const kmBySource: Record<string, number> = {};
  const kmByMode: Record<string, number> = {};
  const stageDays = new Set<string>();
  let unstaged = 0;
  for (const seg of segmentsOf(r.stations, r.legs)) {
    const bucket = stretchBucket(seg.from, seg.to, tripPhase, ctx.now);
    const segRoad = seg.legs.reduce((s, l) => (l.mode === "road" ? s + l.distanceKm : s), 0);
    if (bucket === "recorded") {
      km.recorded += seg.km;
      roadKm.recorded += segRoad;
      for (const leg of seg.legs) {
        kmBySource[leg.source] = (kmBySource[leg.source] ?? 0) + leg.distanceKm;
        kmByMode[leg.mode] = (kmByMode[leg.mode] ?? 0) + leg.distanceKm;
      }
      const leave = stationDays(seg.from).last;
      const arrive = stationDays(seg.to).first;
      if (leave !== null && leave === arrive) {
        stageDays.add(arrive);
        // A driving day counts the road only: a 600 km ferry crossing is a
        // day on board, never the longest day behind the wheel.
        if (segRoad > 0) {
          const key = stages.find((d) => d.roadtripId === r.id && d.day === arrive);
          if (key) key.km += segRoad;
          else stages.push({ roadtripId: r.id, name: r.name, day: arrive, km: segRoad });
        }
      } else {
        unstaged += 1;
        // A drive over several days is no rest on any of them.
        if (leave && arrive && leave < arrive) {
          for (
            let t = Date.parse(`${leave}T00:00:00Z`);
            t <= Date.parse(`${arrive}T00:00:00Z`);
            t += DAY_MS
          ) {
            stageDays.add(new Date(t).toISOString().slice(0, 10));
          }
        } else {
          if (leave) stageDays.add(leave);
          if (arrive) stageDays.add(arrive);
        }
      }
    } else {
      km[bucket] += seg.km;
      roadKm[bucket] += segRoad;
    }
  }

  const recordedStations = real.filter((s) => isRecorded(stationPhase(s, ctx.now), tripPhase));
  const aheadStations = real.filter((s) => !recordedStations.includes(s));
  const recordedNights = countRoadtripNights(recordedStations.map(countable));
  const plannedNights = countRoadtripNights(aheadStations.map(countable));

  const recordedCountries = stationCountries(recordedStations, ctx.resolver);
  // Countries still ahead that no recorded station has already reached.
  const plannedCountries = stationCountries(aheadStations, ctx.resolver).filter(
    (c) => !recordedCountries.includes(c)
  );

  const tours = (ctx.toursByRoadtrip.get(r.id) ?? []).filter((t) => t.state === "completed");
  const ascents = tours.flatMap((t) => (t.ascentM === null ? [] : [t.ascentM]));
  const toursAt = (stationId: string): number =>
    tours.filter((t) => t.tour.anchorStopId === stationId).length;
  const baseCamps = recordedStations.filter(
    (s) =>
      countRoadtripNights([countable(s)]).nights >= BASE_CAMP_NIGHTS &&
      toursAt(s.id) >= BASE_CAMP_TOURS
  ).length;

  return {
    row: {
      id: r.id,
      name: r.name,
      year: firstDay ? Number(firstDay.slice(0, 4)) : null,
      firstDay: firstDay ?? null,
      phase: tripPhase,
      km,
      roadKm,
      kmBySource,
      kmByMode,
      nights: { recorded: recordedNights.nights, planned: plannedNights.nights },
      nightsByStyle: recordedNights.nightsByStyle,
      unknownLengthStations: recordedNights.unknownLengthStations,
      countries: { recorded: recordedCountries, planned: plannedCountries },
      restDays: tripPhase === "past" ? restDaysOf(real, stageDays) : null,
      tours: {
        completed: tours.length,
        km: tours.reduce((s, t) => s + (t.km ?? 0), 0),
        ascentM: ascents.length > 0 ? ascents.reduce((s, a) => s + a, 0) : null,
      },
    },
    unstaged,
    baseCamps,
  };
}

function itemsOf(rows: readonly RoadtripRow[]): MeasureItems {
  const item = (r: RoadtripRow, contribution: number): MeasureItem => ({
    entry: {
      domain: "roadtrip",
      id: r.id,
      href: `/roadtrips/${r.id}`,
      title: { text: r.name },
      subtitle: null,
      // The first station's own local day — or no date at all. Never a
      // 1 January standing in for "some day that year".
      date: dayPrecisionDate(r.firstDay === null ? null : new Date(`${r.firstDay}T00:00:00Z`)),
    },
    year: r.year,
    contribution,
  });
  const nonZero = (pick: (r: RoadtripRow) => number): MeasureItem[] =>
    rows.filter((r) => pick(r) > 0).map((r) => item(r, pick(r)));
  return {
    roadtripDrivenKm: nonZero((r) => r.kmByMode.road ?? 0),
    roadtripFerryKm: nonZero((r) => r.kmByMode.ferry ?? 0),
    roadtripRecordedNights: nonZero((r) => r.nights.recorded),
  };
}

export function computeRoadtripInsights(
  roadtrips: readonly InsightRoadtrip[],
  tours: readonly TourFacts[],
  resolver: Pick<CountryResolver, "countryAt">,
  now: Date
): { insights: RoadtripInsights; items: MeasureItems } {
  const toursByRoadtrip = new Map<string, TourFacts[]>();
  for (const t of tours) {
    if (!t.tour.anchorRoadtripId) continue;
    toursByRoadtrip.set(t.tour.anchorRoadtripId, [
      ...(toursByRoadtrip.get(t.tour.anchorRoadtripId) ?? []),
      t,
    ]);
  }
  const ctx: Context = { resolver, now, toursByRoadtrip };
  const stages: DayStage[] = [];
  const rows: RoadtripRow[] = [];
  let unstagedLegs = 0;
  let baseCampStations = 0;
  for (const r of roadtrips) {
    const { row, unstaged, baseCamps } = rowOf(r, ctx, stages);
    rows.push(row);
    unstagedLegs += unstaged;
    baseCampStations += baseCamps;
  }

  // A roadtrip that has not started counts for nothing — the rule since 2.7.
  const started = rows.filter((r) => r.phase !== "planned");
  const longestDay = stages.reduce<DayStage | null>(
    (best, d) => (!best || d.km > best.km ? d : best),
    null
  );
  const tourStations = new Set(
    tours
      .filter((t) => t.state === "completed" && t.tour.anchorStopId && t.tour.anchorRoadtripId)
      .map((t) => t.tour.anchorStopId as string)
  );

  return {
    insights: {
      roadtrips: rows,
      pace: {
        dayStages: stages.length,
        medianDayKm: median(stages.map((d) => d.km)),
        longestDay,
        unstagedLegs,
        restDays: rows.reduce((s, r) => s + (r.restDays ?? 0), 0),
        fullyDatedTrips: rows.filter((r) => r.restDays !== null).length,
      },
      awards: {
        roadtripsCount: started.length,
        recordedKm: started.reduce((s, r) => s + r.km.recorded, 0),
        longestRecordedKm: Math.max(0, ...started.map((r) => r.km.recorded)),
        recordedFreeNights: started.reduce((s, r) => s + r.nightsByStyle.pitch, 0),
        recordedCountriesMax: Math.max(0, ...started.map((r) => r.countries.recorded.length)),
        baseCampStations,
        landAndWaterTrips: started.filter(
          (r) => (r.kmByMode.road ?? 0) > 0 && (r.kmByMode.ferry ?? 0) > 0
        ).length,
        tourStations: tourStations.size,
      },
    },
    items: itemsOf(rows),
  };
}
