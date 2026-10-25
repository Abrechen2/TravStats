/**
 * Country questions from TravTrack (TravTrack plan E6; review focus 19, 20).
 *
 * TravTrack's country days are observations, never evidence (forgejo#299): a
 * country only they name stays out of the passport's counts. This asks the user
 * instead, in the inbox: a country with at least two GROUND days in a row
 * (`airportPointCount < pointCount` — not only airside) that the passport does
 * not hold and the user gave no verdict on becomes one question per run of
 * consecutive UTC days. The answer is the user's own country override
 * (`acceptCountrySuggestion`); TravTrack never writes one.
 *
 *   - Provider `travtrack` and working only — a Dawarich or `none` account is
 *     never asked (open owner decision (c)), and TravTrack switched off asks
 *     nothing.
 *   - A pending question grows with its run; a run that touches a rejected,
 *     accepted or answering question is never asked again.
 *   - Bounded: at most `MAX_NEW_COUNTRY_QUESTIONS` new questions per run.
 *   - Published under the TravTrack lock, and only if the history generation
 *     is still the one captured before the read (E5's fence).
 *
 * A question holds a country code, days and counts — no position, no digest.
 */
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { loadPassport } from "../stats/passportLoader";
import { getLocationProvider } from "../locationProvider/provider";
import { takeTravTrackLock } from "../travtrack/lock";
import { explanation } from "./envelope";
import { historyGeneration } from "./generation";
import { countryEvidenceKey } from "./key";

/** New country questions per run at most (review focus 19). */
export const MAX_NEW_COUNTRY_QUESTIONS = 3;
/** Ground days a run needs before it is asked. */
export const MIN_GROUND_DAYS = 2;
/** The country rule's version, stored in `location_suggestions.algorithm`. */
export const COUNTRY_ALGORITHM = 1;

const DAY_MS = 86_400_000;

export type CountryDayInput = {
  date: Date;
  countryCode: string;
  pointCount: number;
  airportPointCount: number;
  partialWindow: boolean;
};

/** Consecutive ground days of one country. Days are `YYYY-MM-DD`, UTC. */
export type GroundRun = {
  countryCode: string;
  firstDay: string;
  lastDay: string;
  days: number;
  pointCount: number;
  partial: boolean;
};

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** A ground day is one not spent airside only. */
const isGround = (r: CountryDayInput) => r.pointCount > 0 && r.airportPointCount < r.pointCount;

/** The runs of consecutive ground days per country, oldest first. Pure. */
export function groundRuns(rows: readonly CountryDayInput[]): GroundRun[] {
  const byCountry = new Map<string, CountryDayInput[]>();
  for (const row of rows.filter(isGround)) {
    const list = byCountry.get(row.countryCode) ?? [];
    list.push(row);
    byCountry.set(row.countryCode, list);
  }
  const runs: GroundRun[] = [];
  for (const [countryCode, list] of byCountry) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const own: GroundRun[] = [];
    for (const row of sorted) {
      const day = dayOf(row.date);
      const last = own.at(-1);
      // One row per country and day (the table's unique key): the next day
      // extends the run, anything later starts a new one.
      if (last && dayMs(day) - dayMs(last.lastDay) === DAY_MS) {
        own[own.length - 1] = {
          ...last,
          lastDay: day,
          days: last.days + 1,
          pointCount: last.pointCount + row.pointCount,
          partial: last.partial || row.partialWindow,
        };
      } else {
        own.push({
          countryCode,
          firstDay: day,
          lastDay: day,
          days: 1,
          pointCount: row.pointCount,
          partial: row.partialWindow,
        });
      }
    }
    runs.push(...own);
  }
  return runs.sort(
    (a, b) => a.firstDay.localeCompare(b.firstDay) || a.countryCode.localeCompare(b.countryCode)
  );
}

/** The run's window, `[firstDay 00:00Z, day after lastDay 00:00Z)`. */
export const runWindow = (run: Pick<GroundRun, "firstDay" | "lastDay">) => ({
  from: new Date(dayMs(run.firstDay)),
  until: new Date(dayMs(run.lastDay) + DAY_MS),
});

/** The account's TravTrack country days inside `[from, until)`, or all of them. */
export async function travTrackCountryDays(
  userId: string,
  window?: { from: Date; until: Date },
  countryCode?: string
): Promise<CountryDayInput[]> {
  return prisma.countryDay.findMany({
    where: {
      userId,
      source: "travtrack",
      ...(countryCode ? { countryCode } : {}),
      ...(window ? { date: { gte: window.from, lt: window.until } } : {}),
    },
    select: {
      date: true,
      countryCode: true,
      pointCount: true,
      airportPointCount: true,
      partialWindow: true,
    },
  });
}

const questionFields = (run: GroundRun) => {
  const { from, until } = runWindow(run);
  return {
    windowFrom: from,
    windowUntil: until,
    explanation: explanation("country.groundDays", {
      country: run.countryCode,
      days: run.days,
      points: run.pointCount,
    }) as unknown as Prisma.InputJsonValue,
    evidence: {
      countryCode: run.countryCode,
      days: run.days,
      pointCount: run.pointCount,
      readCoverage: run.partial ? "truncated" : "complete",
    } as unknown as Prisma.InputJsonValue,
  };
};

type Existing = {
  id: string;
  status: string;
  windowFrom: Date;
  windowUntil: Date;
  evidence: unknown;
  explanation: unknown;
};

const countryOf = (row: Existing): string | null => {
  const e = row.evidence as { countryCode?: unknown } | null;
  return typeof e?.countryCode === "string" ? e.countryCode : null;
};

/** The run touches the row's window (overlapping or adjoining). */
const touches = (run: GroundRun, row: Existing) => {
  const { from, until } = runWindow(run);
  return from <= row.windowUntil && row.windowFrom <= until;
};

export type CountrySuggestionsResult = {
  /** `skipped`: not a working TravTrack account, or TravTrack is off. `stale`: history removed meanwhile. */
  status: "done" | "skipped" | "stale";
  created: number;
  grown: number;
  /** New runs left for a later run by the bound. */
  deferred: number;
};

export type CountrySuggestionsDeps = {
  /** Test seam: runs after the read, before the publication. */
  afterRead?: () => Promise<void>;
};

/** Countries the passport holds, and those the user gave a verdict on. */
async function knownCountries(userId: string): Promise<Set<string>> {
  const [passport, overrides] = await Promise.all([
    loadPassport(userId),
    prisma.countryOverride.findMany({ where: { userId }, select: { countryCode: true } }),
  ]);
  return new Set([
    ...passport.countries.map((c) => c.code.toUpperCase()),
    ...overrides.map((o) => o.countryCode.toUpperCase()),
  ]);
}

export async function countrySuggestions(
  userId: string,
  deps: CountrySuggestionsDeps = {}
): Promise<CountrySuggestionsResult> {
  const result: CountrySuggestionsResult = { status: "done", created: 0, grown: 0, deferred: 0 };
  const provider = await getLocationProvider(userId);
  if (provider.kind !== "travtrack" || provider.status !== "ok") {
    return { ...result, status: "skipped" };
  }
  const generation = await prisma.$transaction((tx) => historyGeneration(tx, userId));
  const candidates = groundRuns(await travTrackCountryDays(userId)).filter(
    (run) => run.days >= MIN_GROUND_DAYS
  );
  if (candidates.length === 0) return result;
  const known = await knownCountries(userId);
  const runs = candidates.filter((run) => !known.has(run.countryCode.toUpperCase()));
  if (runs.length === 0) return result;
  const existing: Existing[] = await prisma.locationSuggestion.findMany({
    where: { userId, kind: "country", status: { not: "invalidated" } },
    select: {
      id: true,
      status: true,
      windowFrom: true,
      windowUntil: true,
      evidence: true,
      explanation: true,
    },
  });
  await deps.afterRead?.();

  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    if ((await historyGeneration(tx, userId)) !== generation) {
      logger.info({ operation: "location.countrySuggestions.stale", userId });
      return { ...result, status: "stale" as const };
    }
    for (const run of runs) {
      const matching = existing.filter(
        (row) => countryOf(row) === run.countryCode && touches(run, row)
      );
      // Answered, or being answered: never asked again.
      if (matching.some((row) => row.status !== "pending")) continue;
      const fields = questionFields(run);
      if (matching.length > 0) {
        const row = matching[0];
        const same =
          row.windowFrom.getTime() === fields.windowFrom.getTime() &&
          row.windowUntil.getTime() === fields.windowUntil.getTime() &&
          JSON.stringify(row.explanation) === JSON.stringify(fields.explanation);
        if (same) continue;
        // Conditional on `pending`: an accept that claimed it meanwhile wins.
        const { count } = await tx.locationSuggestion.updateMany({
          where: { id: row.id, status: "pending" },
          data: { ...fields, providerRev: provider.rev },
        });
        result.grown += count;
        continue;
      }
      if (result.created >= MAX_NEW_COUNTRY_QUESTIONS) {
        result.deferred += 1;
        continue;
      }
      const evidenceKey = countryEvidenceKey(run.countryCode, run.firstDay);
      const prior = await tx.locationSuggestion.findUnique({
        where: { userId_kind_evidenceKey: { userId, kind: "country", evidenceKey } },
        select: { id: true, status: true },
      });
      const data = {
        ...fields,
        provider: "travtrack",
        providerRev: provider.rev,
        algorithm: COUNTRY_ALGORITHM,
        status: "pending",
        claimToken: null,
        claimedAt: null,
        resolvedAt: null,
        detectedAt: new Date(),
      };
      if (prior) {
        // Only an invalidated question comes back: its evidence went, and new
        // history of the same days asks afresh.
        if (prior.status !== "invalidated") continue;
        await tx.locationSuggestion.update({ where: { id: prior.id }, data });
      } else {
        await tx.locationSuggestion.create({
          data: { ...data, userId, kind: "country", evidenceKey },
        });
      }
      result.created += 1;
    }
    return result;
  });
}

/**
 * The accept's re-check by the country rule itself: TravTrack still names
 * the country on at least two ground days inside the question's window.
 */
export async function countryRunHolds(
  userId: string,
  countryCode: string,
  window: { from: Date; until: Date }
): Promise<boolean> {
  const rows = await travTrackCountryDays(userId, window, countryCode);
  return rows.filter(isGround).length >= MIN_GROUND_DAYS;
}
