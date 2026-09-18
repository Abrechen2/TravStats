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
import { getCachedAirports } from "../../services/airportCache";

/**
 * `EvidenceResolver` for `kind: "ranking"`. `airline` (Task 5,
 * task-5-brief.md) is the hardest identity in the feature and stays first —
 * the ranking (`GET /stats/airlines`, `routes/stats.ts`) is a Prisma
 * `groupBy(["airline", "airlineIata", "airlineIcao"])` whose ROWS are then
 * folded by `groupAirlines`, so one ranking row can cover several stored
 * spellings, and evidence has to select exactly the flights that fold into
 * the requested row.
 *
 * `airport` / `country` / `aircraftType` (Task 6, task-6-brief.md) each
 * disagree with the airline resolver in a specific way documented on their
 * own function — an airport credits a flight up to TWICE, a country credits
 * it at most ONCE per flight even though a flight has two ends, and an
 * aircraft type groups on the raw stored string rather than folding several
 * spellings together. `continent` is a fifth value in `RANKING_DIMENSIONS`
 * (`shared/evidence.ts`) that this resolver deliberately never serves — see
 * the `continent` case below.
 */
export async function resolveRankingEvidence(
  userId: string,
  key: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  const parsed = parseRankingKey(key);
  if (!parsed) return null;
  switch (parsed.dimension) {
    case "airline":
      return resolveAirlineRankingEvidence(userId, parsed.value, scope, page);
    case "airport":
      return resolveAirportRankingEvidence(userId, parsed.value, scope, page);
    case "country":
      return resolveCountryRankingEvidence(userId, parsed.value, scope, page);
    case "aircraftType":
      return resolveAircraftTypeRankingEvidence(userId, parsed.value, scope, page);
    case "continent":
      // Deliberate abstention, not a gap (task-6-brief.md, "STOP AND
      // REPORT"; task-6-report.md has the finding in full). No
      // `/stats/continents` ranking endpoint exists anywhere in this
      // codebase. The only source close to it, `continentDistribution`
      // (`utils/stats/airportStats.ts`), is a flat `Record<continent,
      // count>` embedded inside `/stats/airports`'s response — the surface
      // inventory itself classifies it as a "distribution", the SAME
      // category as `seatClassStats`/`statusStats`/`boardingGroupStats`,
      // which the inventory already keeps out of the evidence registry for
      // the identical reason: it is not an ordered list of individually
      // identified rows the way `topAirports` (a real top-N list) or a
      // `groupBy` result (aircraft types, airlines) is. There is no row on
      // any screen a click could resolve to `continent:<name>` today, so a
      // resolver here would answer a request the frontend has no honest way
      // to construct. If a `/stats/continents`-shaped ranking is ever built,
      // this case gets a resolver the same way the other four did — not
      // before.
      return null;
  }
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

// ─── Airport ────────────────────────────────────────────────────────────────

/** Minimal identity: the two endpoint codes plus what sorting needs. */
interface AirportIdentityRow {
  id: string;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  departureTime: Date | null;
}

/** Which end(s) of a flight credited the requested airport. */
type AirportCreditRole = "departure" | "arrival" | "both";

interface AirportCredit {
  row: AirportIdentityRow;
  contribution: number;
  role: AirportCreditRole;
}

/**
 * `calculateAirportStats` (`utils/stats/airportStats.ts`) bumps a `visits`
 * map for `dep` and `arr` INDEPENDENTLY — `if (dep) bump(visits, dep); if
 * (arr) bump(visits, arr)` — with no per-flight de-duplication. A flight
 * whose departure and arrival are the same airport (a positioning leg back
 * to base, a scenic round trip) therefore credits that airport TWICE from a
 * SINGLE flight. This is why airport evidence is a `sum` over ENDPOINT
 * OCCURRENCES, not a `distinct` count of flights: an entry with
 * `contribution: 2` names ONE flight, not two, and carries `role` so a
 * reader does not mistake the 2 for the same flight counted twice by
 * mistake (task-6-brief.md's own warning about exactly this).
 */
function matchAirportCredit(row: AirportIdentityRow, code: string): AirportCredit | null {
  // `||`, not `??`, because `calculateAirportStats` resolves the same two
  // columns with `||` (`airportStats.ts`: `const dep = f.depIata ||
  // f.depIcao`). An empty-string `depIata` is falsy but not nullish, so `??`
  // kept it: the ranking counted such a flight under its ICAO code while the
  // panel matched it under neither, and the tile's own number then had no
  // rows to show for part of itself.
  const depCode = row.depIata || row.depIcao;
  const arrCode = row.arrIata || row.arrIcao;
  const depMatches = depCode === code;
  const arrMatches = arrCode === code;
  if (!depMatches && !arrMatches) return null;
  const role: AirportCreditRole =
    depMatches && arrMatches ? "both" : depMatches ? "departure" : "arrival";
  return { row, contribution: (depMatches ? 1 : 0) + (arrMatches ? 1 : 0), role };
}

async function resolveAirportRankingEvidence(
  userId: string,
  code: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  // `/stats/airports` (`routes/stats.ts`) DOES read `fromDate`/`toDate` off
  // its query — an arbitrary date range, not a `year` in the evidence
  // sense — but no caller ever sends one: `AdvancedStatsPage.tsx` calls
  // `getAirportStats()` with no filters, so the tile this evidence backs is
  // always all-time in practice. Rejecting any scope but `allTime` keeps
  // evidence from claiming a population the tile never actually shows — the
  // same reasoning the airline resolver above applies to an endpoint that
  // has no query parameter at all.
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `Airport ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }

  const identityRows: AirportIdentityRow[] = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
    },
  });

  const credits = identityRows
    .map((row) => matchAirportCredit(row, code))
    .filter((c): c is AirportCredit => c !== null);
  const totalContribution = credits.reduce((total, c) => total + c.contribution, 0);

  const skeletons: EvidenceEntry[] = credits.map((c) => ({
    domain: "flight",
    id: c.row.id,
    href: `/flights/${c.row.id}`,
    title: { text: "" },
    subtitle: null,
    date: c.row.departureTime
      ? { value: c.row.departureTime.toISOString().slice(0, 10), precision: "day" as const }
      : null,
    contribution: c.contribution,
  }));
  const sorted = sortEntries(skeletons);
  const paged = sliceEntries(sorted, page);
  const creditByFlightId = new Map(credits.map((c) => [c.row.id, c]));

  // Display fields hydrated for the returned PAGE only, same reasoning as
  // the airline resolver: an account with thousands of flights through one
  // hub pays for one full-row fetch sized to `limit`, not to its history.
  const details = paged.length
    ? await prisma.flight.findMany({
        where: { id: { in: paged.map((entry) => entry.id) } },
        select: {
          id: true,
          flightNumber: true,
          depIata: true,
          depIcao: true,
          arrIata: true,
          arrIcao: true,
        },
      })
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));

  const entries: EvidenceEntry[] = paged.map((skeleton) => {
    const detail = detailById.get(skeleton.id);
    const credit = creditByFlightId.get(skeleton.id)!;
    // Same `||` as `matchAirportCredit` above: a row credited through its
    // ICAO code must also be LABELLED with it, not with the empty string
    // that got it there.
    const depCode = detail?.depIata || detail?.depIcao || "?";
    const arrCode = detail?.arrIata || detail?.arrIcao || "?";
    return {
      domain: "flight",
      id: skeleton.id,
      href: `/flights/${skeleton.id}`,
      title: { text: detail?.flightNumber ?? "—" },
      // `role` is what makes `contribution: 2` legible on its own, without
      // the reader having to notice that `dep` and `arr` happen to match —
      // an i18n key, not `{ text }`, because "credited as both" is a
      // computed classification, not the traveller's own data.
      subtitle: {
        key: "evidence.ranking.airport.subtitle",
        values: { dep: depCode, arr: arrCode, role: credit.role },
      },
      date: skeleton.date,
      contribution: credit.contribution,
    };
  });

  const returnedContribution = entries.reduce((total, e) => total + (e.contribution ?? 0), 0);
  const omittedContribution = totalContribution - returnedContribution;

  return {
    measure: {
      kind: "ranking",
      key: rankingKey("airport", code),
      aggregation: "sum",
      label: { key: "evidence.ranking.airport", values: { airport: code } },
      // "visits", not "flights" — the exact distinction this dimension
      // exists to preserve: one flight can BE two visits to this airport.
      unit: "visits",
      value: totalContribution,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: credits.length - entries.length, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

// ─── Country ────────────────────────────────────────────────────────────────

/** Minimal identity: the two endpoint codes plus what sorting needs. */
interface CountryIdentityRow {
  id: string;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  departureTime: Date | null;
}

/**
 * `GET /stats/countries` (`routes/stats.ts`) folds a flight's two ends into
 * a per-flight `Set` BEFORE counting a country — a domestic flight visits
 * its country once, not twice, and a flight with no recorded arrival
 * airport touches only whichever end IS on file, never inventing a second
 * "Unknown" (the route's own comment: "otherwise an incomplete row would
 * invent a second 'Unknown' visit"). This is why country evidence, unlike
 * airport evidence above, never needs a `role` or a `contribution` above 1:
 * the ranking's own de-duplication already collapses one flight to at most
 * one credit per country. This mirrors the route's INLINE computation
 * exactly — it is not exported as a shared helper anywhere in the codebase.
 *
 * Deliberately NOT routed through the passport engine (`loadPassport` /
 * `trackEvidence.ts`): `/stats/countries` and the passport are two
 * different, both-legitimate answers to "how many countries" (design doc
 * refutation #3, "these are LISTS, and they stay lists"; `/stats/hero`
 * already uses the passport count for its own tile, and the overview unions
 * across visible domains for its). This resolver backs the FLIGHT
 * distribution tile specifically, so it stays on that tile's own rule.
 */
function flightTouchesCountry(
  row: CountryIdentityRow,
  airportMap: Map<string, { country?: string | null }>,
  targetCountry: string
): boolean {
  // `??` here, `||` in `matchAirportCredit` above — deliberately, and each
  // copies its OWN calculator: `/stats/countries` resolves the pair with
  // `f.depIata ?? f.depIcao`, `calculateAirportStats` with `||`. An
  // empty-string `depIata` therefore lands in "Unknown" for the country
  // distribution and under the ICAO code for the airport ranking, and
  // evidence has to say what the tile above it says, not what either of us
  // would prefer. Unifying the two operators is a change to the RANKINGS,
  // not to their evidence.
  const depCode = row.depIata ?? row.depIcao;
  const arrCode = row.arrIata ?? row.arrIcao;
  const touched = new Set<string>();
  touched.add((depCode ? airportMap.get(depCode)?.country : null) ?? "Unknown");
  if (arrCode) {
    touched.add(airportMap.get(arrCode)?.country ?? "Unknown");
  }
  return touched.has(targetCountry);
}

async function resolveCountryRankingEvidence(
  userId: string,
  countryCode: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  // `/stats/countries` reads no query parameter at all — not even the
  // `fromDate`/`toDate` `/stats/airports` accepts — so, like the airline
  // ranking, it measures ALL TIME unconditionally.
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `Country ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }

  const identityRows: CountryIdentityRow[] = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
    },
  });

  const airportCodes = new Set<string>();
  for (const row of identityRows) {
    const depCode = row.depIata ?? row.depIcao;
    const arrCode = row.arrIata ?? row.arrIcao;
    if (depCode) airportCodes.add(depCode);
    if (arrCode) airportCodes.add(arrCode);
  }
  const airportMap = await getCachedAirports([...airportCodes]);

  const matched = identityRows.filter((row) => flightTouchesCountry(row, airportMap, countryCode));

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

  const details = paged.length
    ? await prisma.flight.findMany({
        where: { id: { in: paged.map((entry) => entry.id) } },
        select: { flightNumber: true, depIata: true, arrIata: true, id: true },
      })
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));
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

  const omittedContribution = matched.length - entries.length;

  return {
    measure: {
      kind: "ranking",
      key: rankingKey("country", countryCode),
      aggregation: "sum",
      label: { key: "evidence.ranking.country", values: { country: countryCode } },
      // "flights", matching the route's own `total` field, which is the
      // FLIGHT count — never mistake this for a country count (the route's
      // `countriesIso.length` is that, and it is a DIFFERENT, distinct
      // measure entirely — see the comment above).
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

// ─── Aircraft type ──────────────────────────────────────────────────────────

interface AircraftTypeIdentityRow {
  id: string;
  departureTime: Date | null;
}

/**
 * `GET /stats/aircraft-types` (`routes/stats/aircraft.ts`) groups by the
 * stored `aircraft` string RAW — it never calls the achievement-side
 * `normalizeAircraft`. Normalising here would merge spellings the ranking
 * keeps apart ("A320" and "Airbus A320" would become one evidence bucket
 * answering for two separate ranking rows), so this resolver matches on
 * exact string equality, mirroring the ranking's own
 * `groupBy(["aircraft"])` (design doc, "Identity" — "Aircraft types are
 * grouped RAW by the ranking, so evidence groups raw too"). This is
 * deliberate mirroring of the ranking's behaviour, not an endorsement of
 * it — a future normalisation pass would need to change both, together.
 *
 * The ranking excludes `aircraft: null` (`aircraft: { not: null } }`) but
 * does NOT exclude an empty string — a flight with `aircraft: ""` forms its
 * own group there, and this resolver mirrors that inclusion rather than
 * "fixing" it. Note that such a row is unaddressable through this endpoint
 * regardless: `parseRankingKey` (`shared/evidence.ts`) rejects an empty
 * `value` outright, which is an existing limitation of the shared key
 * format and not something this resolver can or should work around.
 */
async function resolveAircraftTypeRankingEvidence(
  userId: string,
  aircraft: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `Aircraft-type ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }

  // Unlike the airline fold, exact equality on the raw stored column can be
  // pushed straight into the WHERE clause — no per-row re-derivation is
  // needed, so this identity pass already returns only matching flights (one
  // query narrower than the airline/airport/country resolvers, which have to
  // load every countable flight to re-run their fold in JS).
  const identityRows: AircraftTypeIdentityRow[] = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere(), aircraft },
    select: { id: true, departureTime: true },
  });

  const skeletons: EvidenceEntry[] = identityRows.map((row) => ({
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

  const details = paged.length
    ? await prisma.flight.findMany({
        where: { id: { in: paged.map((entry) => entry.id) } },
        select: { flightNumber: true, depIata: true, arrIata: true, id: true },
      })
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));
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

  const omittedContribution = identityRows.length - entries.length;

  return {
    measure: {
      kind: "ranking",
      key: rankingKey("aircraftType", aircraft),
      aggregation: "sum",
      label: { key: "evidence.ranking.aircraftType", values: { aircraft } },
      unit: "flights",
      value: identityRows.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedContribution, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}
