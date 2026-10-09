/**
 * `GET /stats/cruise-insights` (forgejo#257), assembled from the pure folds
 * beside this file over ONE context (`./load.ts`) — the same folds the
 * evidence resolvers and the badges call.
 *
 * `year` cuts the per-cruise lists and the stays and excursions to the cruises
 * that STARTED that year (the cruise tab's year rule); whether a port is new
 * is still judged against every sailed cruise. The year tables always cover
 * every year — they are per year by nature.
 */

import type { CruiseInsights, CruiseRef } from "../../../schemas/statsCruiseInsights";
import { cruiseDays } from "./dayPattern";
import { CRUISE_EVENTS, eventsOfCruise } from "./events";
import { EXCURSION_LINK_KM, excursionsOf } from "./excursions";
import { linkedToursOf, type CruiseInsightContext } from "./load";
import {
  cruisesPerPort,
  foldNewAndRevisited,
  longestPortReunion,
  portsOfCruise,
  repeatedItineraries,
  unresolvedCallsOf,
} from "./ports";
import { foldPortStays, stayExtremes, type PortStay } from "./portStays";
import type { CruiseInsightRow } from "./rows";

const REPEAT_PORT_LIST_LENGTH = 10;

const refOf = (row: CruiseInsightRow): CruiseRef => ({
  id: row.id,
  label: row.label,
  startDate: row.startDay,
});

export function inYear(rows: readonly CruiseInsightRow[], year: number | null): CruiseInsightRow[] {
  return year === null ? [...rows] : rows.filter((r) => r.year === year);
}

function portsSection(ctx: CruiseInsightContext, scoped: readonly CruiseInsightRow[]) {
  const byId = new Map(ctx.rows.map((r) => [r.id, r]));
  const folds = foldNewAndRevisited(ctx.rows);
  const foldOf = new Map(folds.map((f) => [f.cruiseId, f]));
  const years = new Map<number, CruiseInsights["ports"]["years"][number]>();
  for (const fold of folds) {
    const row = byId.get(fold.cruiseId)!;
    const year = row.year!;
    const prev = years.get(year) ?? { year, cruises: 0, ports: 0, newPorts: [], revisitedPorts: 0 };
    years.set(year, {
      year,
      cruises: prev.cruises + 1,
      ports: 0,
      newPorts: [...prev.newPorts, ...fold.newPorts.map((p) => ({ id: p.id, name: p.name }))],
      revisitedPorts: prev.revisitedPorts + fold.revisitedPorts.length,
    });
  }
  // Distinct ports of each year, over its dated cruises.
  for (const [year, entry] of years) {
    const distinct = new Set(
      ctx.rows.filter((r) => r.year === year).flatMap((r) => portsOfCruise(r).map((p) => p.id))
    );
    years.set(year, { ...entry, ports: distinct.size });
  }
  const reunion = longestPortReunion(ctx.rows);
  const scopedIds = new Set(scoped.map((r) => r.id));
  return {
    years: [...years.values()].sort((a, b) => a.year - b.year),
    perCruise: scoped.map((row) => {
      const fold = foldOf.get(row.id);
      return {
        cruise: refOf(row),
        ports: portsOfCruise(row).length,
        newPorts: fold?.newPorts.length ?? 0,
        revisitedPorts: fold?.revisitedPorts.length ?? 0,
        unresolvedCalls: unresolvedCallsOf(row),
      };
    }),
    longestReunion: reunion
      ? {
          portId: reunion.portId,
          portName: reunion.portName,
          fromCruise: refOf(byId.get(reunion.fromCruiseId)!),
          toCruise: refOf(byId.get(reunion.toCruiseId)!),
          fromDay: reunion.fromDay,
          toDay: reunion.toDay,
          days: reunion.days,
        }
      : null,
    repeatPorts: cruisesPerPort(ctx.rows)
      .filter((p) => p.cruiseIds.length >= 2 && p.cruiseIds.some((id) => scopedIds.has(id)))
      .slice(0, REPEAT_PORT_LIST_LENGTH)
      .map((p) => ({
        portId: p.portId,
        portName: p.portName,
        cruises: p.cruiseIds.map((id) => refOf(byId.get(id)!)),
      })),
    undatedCruises: scoped.filter((r) => r.startDay === null).length,
    unresolvedCalls: scoped.reduce((sum, r) => sum + unresolvedCallsOf(r), 0),
  };
}

function portStaysSection(scoped: readonly CruiseInsightRow[]): CruiseInsights["portStays"] {
  const byId = new Map(scoped.map((r) => [r.id, r]));
  const fold = foldPortStays(scoped);
  const { shortest, longest } = stayExtremes(fold.stays);
  const total = fold.stays.reduce((sum, s) => sum + s.minutes, 0);
  const asStay = (s: PortStay | null) =>
    s
      ? {
          cruise: refOf(byId.get(s.cruiseId)!),
          stopId: s.stopId,
          portName: s.portName,
          day: s.day,
          minutes: s.minutes,
        }
      : null;
  return {
    calls: fold.calls,
    measured: fold.stays.length,
    missingTime: fold.missingTime,
    inconsistent: fold.inconsistent,
    totalMinutes: total,
    averageMinutes: fold.stays.length > 0 ? total / fold.stays.length : null,
    longest: asStay(longest),
    shortest: asStay(shortest),
  };
}

function excursionsSection(
  ctx: CruiseInsightContext,
  scoped: readonly CruiseInsightRow[]
): CruiseInsights["excursions"] {
  const perCruise = scoped.map((row) => ({
    row,
    ex: excursionsOf(row, linkedToursOf(ctx, row.id)),
  }));
  return {
    toursVisible: ctx.toursVisible,
    linkRuleKm: EXCURSION_LINK_KM,
    cruisesWithExcursions: perCruise.filter(({ ex }) => ex.documentedStopIds.length > 0).length,
    documentedCalls: perCruise.reduce((sum, { ex }) => sum + ex.documentedStopIds.length, 0),
    portsWithExcursions: new Set(perCruise.flatMap(({ ex }) => ex.documentedPortIds)).size,
    perCruise: perCruise.map(({ row, ex }) => ({
      cruise: refOf(row),
      calls: ex.calls,
      notedCalls: ex.notedCalls,
      documentedCalls: ex.documentedStopIds.length,
      tours:
        ex.tours === null
          ? null
          : ex.tours.map((t) => ({
              id: t.id,
              name: t.name,
              activity: t.activity,
              day: t.day,
              portName: t.portName,
              distanceKm: t.distanceKm,
              ascentM: t.ascentM,
            })),
      activities: ex.activities,
      distanceKm: ex.distanceKm,
      onFootKm: ex.onFootKm,
      ascentM: ex.ascentM,
    })),
  };
}

function dayPatternSection(
  ctx: CruiseInsightContext,
  scoped: readonly CruiseInsightRow[]
): CruiseInsights["dayPattern"] {
  const years = new Map<number, CruiseInsights["dayPattern"]["years"][number]>();
  for (const row of ctx.rows) {
    if (row.year === null) continue;
    const d = cruiseDays(row);
    const prev = years.get(row.year) ?? {
      year: row.year,
      cruises: 0,
      seaDays: 0,
      portDays: 0,
      seaHeavy: 0,
      balanced: 0,
      portIntensive: 0,
      unclassified: 0,
    };
    years.set(row.year, {
      ...prev,
      cruises: prev.cruises + 1,
      seaDays: prev.seaDays + d.seaDays,
      portDays: prev.portDays + d.portDays,
      seaHeavy: prev.seaHeavy + (d.type === "seaHeavy" ? 1 : 0),
      balanced: prev.balanced + (d.type === "balanced" ? 1 : 0),
      portIntensive: prev.portIntensive + (d.type === "portIntensive" ? 1 : 0),
      unclassified: prev.unclassified + (d.type === null ? 1 : 0),
    });
  }
  return {
    years: [...years.values()].sort((a, b) => a.year - b.year),
    perCruise: scoped.map((row) => {
      const d = cruiseDays(row);
      return {
        cruise: refOf(row),
        seaDays: d.seaDays,
        portDays: d.portDays,
        listedDays: d.listedDays,
        unlistedDays: d.unlistedDays,
        type: d.type,
      };
    }),
  };
}

export function buildCruiseInsights(
  ctx: CruiseInsightContext,
  year: number | null
): CruiseInsights {
  const scoped = inYear(ctx.rows, year).sort(
    (a, b) => (a.startDay ?? "9999").localeCompare(b.startDay ?? "9999") || a.id.localeCompare(b.id)
  );
  const byId = new Map(ctx.rows.map((r) => [r.id, r]));
  const events = new Map(scoped.map((row) => [row.id, eventsOfCruise(row, ctx.userBirthday)]));
  return {
    year,
    cruises: scoped.length,
    events: {
      birthdayKnown: ctx.userBirthday !== undefined,
      list: CRUISE_EVENTS.map((event) => ({
        event,
        cruises: scoped.filter((r) => events.get(r.id)!.includes(event)).map(refOf),
      })),
    },
    ports: portsSection(ctx, scoped),
    portStays: portStaysSection(scoped),
    excursions: excursionsSection(ctx, scoped),
    dayPattern: dayPatternSection(ctx, scoped),
    repeatedItineraries: repeatedItineraries(ctx.rows)
      .filter((g) => year === null || g.cruiseIds.some((id) => byId.get(id)?.year === year))
      .map((g) => ({ ports: g.ports, cruises: g.cruiseIds.map((id) => refOf(byId.get(id)!)) })),
  };
}
