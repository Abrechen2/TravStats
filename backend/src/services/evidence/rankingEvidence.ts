import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { parseRankingKey, rankingKey } from "../../shared/evidence";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { sortEntries, sliceEntries } from "./paging";
import { countableFlightWhere } from "../../shared/flightCounting";
import { airlineGroupKey, normalizeAirline } from "../../shared/airlineNormalize";
import { airlineResolvers } from "../../utils/airlineNormalize";
import { flightEvidenceEntry } from "./entryMappers";

/**
 * `EvidenceResolver` for `kind: "ranking"` — the airline dimension only.
 * The hardest identity in the feature and the reason it is the first
 * resolver written (task-5-brief.md): the ranking (`GET /stats/airlines`,
 * `routes/stats.ts`) is a Prisma `groupBy(["airline", "airlineIata",
 * "airlineIcao"])` whose ROWS are then folded by `groupAirlines`, so one
 * ranking row can cover several stored spellings, and evidence has to
 * select exactly the flights that fold into the requested row. `airport` /
 * `country` / `continent` / `aircraftType` are added to this same file in
 * Task 6.
 */
export async function resolveRankingEvidence(
  userId: string,
  key: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  const parsed = parseRankingKey(key);
  if (!parsed) return null;
  if (parsed.dimension !== "airline") return null;
  return resolveAirlineRankingEvidence(userId, parsed.value, scope, page);
}

/** Minimal identity projection: the three columns `airlineGroupKey` reads, plus what sorting needs. */
interface AirlineIdentityRow {
  id: string;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureTime: Date | null;
}

/** The only two shapes `airlineGroupKey`/`groupAirlines` (`shared/airlineNormalize.ts`) can produce. */
const AIRLINE_GROUP_KEY_SHAPE = /^(iata|name):.+$/;

async function resolveAirlineRankingEvidence(
  userId: string,
  groupKey: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  // `groupKey` is not free text — `groupAirlines` only ever emits `iata:XX`
  // or `name:some carrier`. Anything else is not a row this ranking could
  // ever produce, so it gets the same 404 an unrecognised metric key gets
  // (a key the frontend cannot build is a frontend bug, not an empty page).
  if (!AIRLINE_GROUP_KEY_SHAPE.test(groupKey)) return null;

  // `GET /stats/airlines` (`routes/stats.ts`) takes no `year`/`domains`
  // query param — its handler builds its `where` from
  // `countableFlightWhere()` alone, with no request-scoped filter, so it
  // measures ALL TIME, unconditionally. Honouring a year HERE would answer a
  // population the tile never shows — a future reader could otherwise "fix"
  // this rejection by teaching the resolver to filter by year alone, which
  // would make evidence disagree with its own ranking row. This is a 400,
  // not a 404: the key is real, the row exists — the request asked it for a
  // population this surface does not measure, which is a bad request, not a
  // missing one (the same distinction the stray-`year`-with-`allTime` case
  // in `schemas/evidence.ts` already makes).
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `Airline ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }

  const identityRows: AirlineIdentityRow[] = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: { id: true, airline: true, airlineIata: true, airlineIcao: true, departureTime: true },
  });

  // `groupAirlines`'s fold has no inverse — its output is a key, its input
  // three nullable columns resolved through a catalogue — so the only
  // faithful way to select "every flight that folds into this row" is to
  // run the SAME fold per flight and keep the ones that agree, rather than
  // trying to invert it into a Prisma `where`. A flight with `airline: null`
  // but `airlineIata: "LH"` agrees with `groupKey === "iata:LH"` here for
  // exactly the reason it was counted there. This pass loads only the three
  // identity columns (plus the date needed to sort), never a full row, for
  // every countable flight the user has — the heavier fetch below is scoped
  // to the page actually returned.
  const matched = identityRows.filter((row) => airlineGroupKey(row, airlineResolvers) === groupKey);

  const skeletons: EvidenceEntry[] = matched.map((row) => ({
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: "" },
    subtitle: null,
    date: row.departureTime
      ? { value: row.departureTime.toISOString().slice(0, 10), precision: "day" as const }
      : null,
    contribution: 1,
  }));
  const sorted = sortEntries(skeletons);
  const paged = sliceEntries(sorted, page);

  // Display fields (flight number, route) are hydrated for the returned
  // PAGE only — the identity pass above never loaded them, so an account
  // with thousands of flights on one airline pays for one full-row fetch
  // sized to `limit`, not to its whole history.
  const details = paged.length
    ? await prisma.flight.findMany({
        where: { id: { in: paged.map((entry) => entry.id) } },
        select: { flightNumber: true, depIata: true, arrIata: true, id: true },
      })
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));
  // `flightEvidenceEntry` builds title/subtitle/href/contribution from the
  // hydrated fields; `date` is overwritten from the skeleton, which already
  // carries it from the identity pass — re-selecting `departureTime` here
  // would fetch the same column twice for no reason.
  const entries: EvidenceEntry[] = paged.map((skeleton) => {
    const detail = detailById.get(skeleton.id);
    const hydrated = flightEvidenceEntry(
      {
        id: skeleton.id,
        flightNumber: detail?.flightNumber ?? null,
        depIata: detail?.depIata ?? null,
        arrIata: detail?.arrIata ?? null,
        departureTime: null,
      },
      1
    );
    return { ...hydrated, date: skeleton.date };
  });

  // `omitted` counts every KNOWN row not in `entries` — on ANY page, not
  // only the rows still ahead of this one. Rows before `offset` are just as
  // known and just as absent from this response as rows after it, and
  // `assertSumInvariant` has to hold on every page, so page three's omitted
  // count includes pages one and two as well as what comes after. (The
  // spec's "hasn't paged there yet" phrasing only reads correctly on page
  // one — corrected there; this is the reading that actually holds.)
  const omittedContribution = matched.length - entries.length;

  return {
    measure: {
      kind: "ranking",
      key: rankingKey("airline", groupKey),
      aggregation: "sum",
      label: {
        key: "evidence.ranking.airline",
        values: { airline: airlineDisplayLabel(groupKey, matched) },
      },
      unit: "flights",
      value: matched.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedContribution, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * The same precedence `groupAirlines` uses for a group's own `label`
 * (catalogue name, else the most frequent spelling among its rows) — so a
 * panel's header reads the same carrier name the ranking row above it does,
 * rather than inventing a second naming rule for the same identity.
 */
function airlineDisplayLabel(groupKey: string, matchedRows: AirlineIdentityRow[]): string {
  if (groupKey.startsWith("iata:")) {
    const iata = groupKey.slice("iata:".length);
    const catalogueName = airlineResolvers.nameForIata(iata);
    if (catalogueName) return catalogueName;
  }
  const spellings = new Map<string, number>();
  for (const row of matchedRows) {
    if (!row.airline?.trim()) continue;
    const spelling = normalizeAirline(row.airline);
    spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1);
  }
  const mostFrequent = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return mostFrequent ?? groupKey.slice(groupKey.indexOf(":") + 1);
}
