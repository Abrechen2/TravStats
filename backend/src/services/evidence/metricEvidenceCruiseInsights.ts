import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { cruiseEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";
import { inYear } from "../stats/cruiseInsights/build";
import { cruiseDays } from "../stats/cruiseInsights/dayPattern";
import { eventsOfCruise, type CruiseEvent } from "../stats/cruiseInsights/events";
import { excursionsOf } from "../stats/cruiseInsights/excursions";
import {
  linkedToursOf,
  loadCruiseInsightContext,
  type CruiseInsightContext,
} from "../stats/cruiseInsights/load";
import { foldNewAndRevisited } from "../stats/cruiseInsights/ports";
import { foldPortStays } from "../stats/cruiseInsights/portStays";
import type { CruiseInsightRow } from "../stats/cruiseInsights/rows";

/**
 * The eleven served cruise-insight measures (forgejo#257). Each lists the
 * cruises behind a figure of the cruise insights section, computed by the
 * fold that figure comes from over the same context — so the panel cannot
 * name a voyage the tile did not count. Year scope: the cruises that STARTED
 * that year, the cruise tab's rule; "new" is still judged against every
 * sailed cruise.
 */

interface Scoped {
  ctx: CruiseInsightContext;
  rows: CruiseInsightRow[];
}

async function loadScoped(userId: string, scope: EvidenceScope, key: string): Promise<Scoped> {
  const year = readYearScope(scope, key);
  const ctx = await loadCruiseInsightContext(userId);
  return { ctx, rows: inYear(ctx.rows, year ?? null) };
}

function entryOf(
  row: CruiseInsightRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels">
): EvidenceEntry {
  return cruiseEvidenceEntry(
    { id: row.id, label: row.label, startDate: row.input.startDate },
    { ...fields, subtitle: null }
  );
}

/**
 * A per-cruise count: each cruise contributes its share; a cruise with none
 * stays out. `prepare` runs once per request and returns the per-cruise count,
 * so a fold over every cruise (new vs. seen again) is not repeated per row.
 */
function perCruiseSum(
  key: string,
  unit: string,
  prepare: (scoped: Scoped) => (row: CruiseInsightRow) => number
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const scoped = await loadScoped(userId, scope, key);
    const countOf = prepare(scoped);
    const counted = scoped.rows.map((row) => ({ row, n: countOf(row) }));
    const entries = counted
      .filter(({ n }) => n > 0)
      .map(({ row, n }) => entryOf(row, { contribution: n }));
    const value = counted.reduce((sum, { n }) => sum + n, 0);
    return domainSumEvidence({ key, unit, scope, page, entries, value });
  };
}

export async function resolveCruiseNewPortsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "cruiseNewPortsCount";
  const { ctx, rows } = await loadScoped(userId, scope, key);
  const folds = new Map(foldNewAndRevisited(ctx.rows).map((f) => [f.cruiseId, f]));
  const entries = rows
    .map((row) => ({ row, ports: folds.get(row.id)?.newPorts ?? [] }))
    .filter(({ ports }) => ports.length > 0)
    .map(({ row, ports }) =>
      entryOf(row, {
        credits: ports.map((p) => String(p.id)),
        creditLabels: Object.fromEntries(ports.map((p) => [String(p.id), p.name])),
      })
    );
  return domainDistinctEvidence({ key, unit: "ports", scope, page, entries });
}

export const resolveCruisePortRevisitCount = perCruiseSum(
  "cruisePortRevisitCount",
  "ports",
  ({ ctx }) => {
    const folds = new Map(foldNewAndRevisited(ctx.rows).map((f) => [f.cruiseId, f]));
    return (row) => folds.get(row.id)?.revisitedPorts.length ?? 0;
  }
);

export const resolveCruiseMeasuredPortStayCount = perCruiseSum(
  "cruiseMeasuredPortStayCount",
  "portCalls",
  () => (row) => foldPortStays([row]).stays.length
);

export const resolveCruiseDocumentedExcursionCount = perCruiseSum(
  "cruiseDocumentedExcursionCount",
  "portCalls",
  ({ ctx }) =>
    (row) =>
      excursionsOf(row, linkedToursOf(ctx, row.id)).documentedStopIds.length
);

export const resolveCruisePortDaysTotal = perCruiseSum(
  "cruisePortDaysTotal",
  "days",
  () => (row) => cruiseDays(row).portDays
);

const eventCount = (key: string, event: CruiseEvent) =>
  perCruiseSum(
    key,
    "cruises",
    ({ ctx }) =>
      (row) =>
        eventsOfCruise(row, ctx.userBirthday).includes(event) ? 1 : 0
  );

export const resolveCruiseEquatorCruiseCount = eventCount("cruiseEquatorCruiseCount", "equator");
export const resolveCruiseDatelineCruiseCount = eventCount("cruiseDatelineCruiseCount", "dateline");
export const resolveCruiseBirthdayAtSeaCruiseCount = eventCount(
  "cruiseBirthdayAtSeaCruiseCount",
  "birthdayAtSea"
);
export const resolveCruiseNewYearAtSeaCruiseCount = eventCount(
  "cruiseNewYearAtSeaCruiseCount",
  "newYearAtSea"
);
export const resolveCruiseCanalCruiseCount = eventCount("cruiseCanalCruiseCount", "canal");
export const resolveCruisePolarCruiseCount = eventCount("cruisePolarCruiseCount", "polar");
