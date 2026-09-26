import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { rankingKey } from "../../shared/evidence";
import type { EvidenceScope, UnattributedReason } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { CountryTimelineEntry } from "../../schemas/statsCountryDetail";
import { buildCountryDetail, type CountryDetail } from "../stats/countryDetail";
import { loadCountryDetailInputs, type CountryDetailInputs } from "../stats/countryDetailLoader";
import { loadPassport } from "../stats/passportLoader";
import type { PagingParams } from "./paging";
import { pageDistinctEntries, pageSumEntries } from "./entryMappersDomains";

/**
 * Evidence for the passport's headline figures (forgejo#132 item 5) and for
 * one country's entries (item 6).
 *
 * ONE RULE, ONE HOME. The passport decides which countries exist, which of
 * them the headline counts, and their continents (`loadPassport`). Which
 * RECORD proves a given country is the drill-down's question
 * (`buildCountryDetail`, the page behind `/stats/countries/:code`), and it is
 * asked here for every country of the passport, with the same loader — so a
 * figure, its country page and the rows listed behind it cannot disagree about
 * which flight, stay or ride stands behind a country. Nothing here re-derives a
 * country from an airport or a port on its own.
 *
 * ALL SOURCES, ALWAYS. This is the passport page's number, which reads every
 * kind of evidence — track and place included. The country BADGES read fewer
 * sources (`utils/achievementCountries.ts`: curated records only, rail and
 * roadtrip only while visible); their evidence is not this evidence, and the
 * headline must not borrow their narrower rule.
 *
 * A country the drill-down can prove only through location history has no row
 * a reader could open: it is reported as `locationHistoryOnly`, never folded
 * into a row that does not prove it.
 */

/** The drill-down's timeline, whole — the page caps it, the evidence must not. */
const EVERY_TIMELINE_ROW = Number.POSITIVE_INFINITY;

function detailFor(code: string, inputs: CountryDetailInputs): CountryDetail | null {
  const [flights, airports, homes, ports, places, lodgings, track, , stations, rail] = inputs;
  return buildCountryDetail(
    code,
    flights,
    airports,
    homes,
    ports,
    places,
    lodgings,
    track,
    EVERY_TIMELINE_ROW,
    stations,
    rail
  );
}

/** A record, gathered across every country whose drill-down lists it. */
interface PassportRecord {
  entry: EvidenceEntry;
  /** Every passport country this record proves — the drill-down's answer. */
  countries: Set<string>;
  /** Flights only: the airports of this leg the passport files under a country. */
  airports: Set<string>;
}

const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

const dayOf = (value: string | null): EvidenceEntry["date"] =>
  value ? { value, precision: "day" } : null;

/**
 * One timeline row as the evidence row it belongs to, keyed so that the same
 * record met under two countries is ONE row crediting both. Track rows name no
 * record and return null — the caller reports them as location history.
 */
function recordOf(
  row: CountryTimelineEntry,
  cruiseLabels: ReadonlyMap<string, string>
): { key: string; entry: EvidenceEntry } | null {
  switch (row.kind) {
    case "flight":
      return {
        key: `flight:${row.flightId}`,
        entry: {
          domain: "flight",
          id: row.flightId,
          href: `/flights/${row.flightId}`,
          title: { text: row.flightNumber ?? "—" },
          subtitle: { text: `${row.depIata ?? "?"} → ${row.arrIata ?? "?"}` },
          date: dayOf(row.date),
        },
      };
    case "port":
      return {
        key: `cruise:${row.cruiseId}`,
        entry: {
          domain: "cruise",
          id: row.cruiseId,
          href: `/cruises/${row.cruiseId}`,
          title: { text: cruiseLabels.get(row.cruiseId) ?? row.portName ?? "—" },
          subtitle: row.portName ? { text: row.portName } : null,
          date: dayOf(row.date),
        },
      };
    case "place":
      return {
        key: `place:${row.placeId}`,
        entry: {
          domain: "place",
          id: row.placeId,
          href: `/places/${row.placeId}`,
          title: { text: row.name },
          subtitle: null,
          date: dayOf(row.date),
        },
      };
    case "lodging":
      return {
        key: `lodging:${row.lodgingId}`,
        entry: {
          domain: "lodging",
          id: row.lodgingId,
          href: `/lodging/${row.lodgingId}`,
          title: { text: row.name },
          subtitle: null,
          date: dayOf(row.date),
        },
      };
    case "rail":
      return {
        key: `rail:${row.rideId}`,
        entry: {
          domain: "rail",
          id: row.rideId,
          href: `/rail/${row.rideId}`,
          title: { text: row.rideLabel },
          subtitle: { text: row.stationName },
          date: dayOf(row.date),
        },
      };
    case "roadtrip":
      return {
        key: `roadtrip:${row.roadtripId}`,
        entry: {
          domain: "roadtrip",
          id: row.roadtripId,
          href: `/roadtrips/${row.roadtripId}`,
          title: { text: row.roadtripName },
          subtitle: { text: row.stationTitle },
          date: dayOf(row.date),
        },
      };
    case "track":
      return null;
  }
}

/** Cruise names for the port-call rows, in one query. */
async function loadCruiseLabels(
  userId: string,
  cruiseIds: readonly string[]
): Promise<Map<string, string>> {
  if (cruiseIds.length === 0) return new Map();
  const rows = await prisma.cruise.findMany({
    where: { userId, id: { in: [...cruiseIds] } },
    select: { id: true, routeName: true, shipNameOverride: true, ship: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.routeName ?? r.shipNameOverride ?? r.ship?.name ?? "—"]));
}

interface PassportEvidenceIndex {
  passport: Awaited<ReturnType<typeof loadPassport>>;
  records: PassportRecord[];
  /** Countries whose drill-down lists measured presence. */
  trackCountries: Set<string>;
}

async function loadPassportEvidenceIndex(userId: string): Promise<PassportEvidenceIndex> {
  const [passport, inputs] = await Promise.all([
    loadPassport(userId),
    loadCountryDetailInputs(userId),
  ]);

  const details = passport.countries
    .map((row) => ({ code: row.code, detail: detailFor(row.code, inputs) }))
    .filter((d): d is { code: string; detail: CountryDetail } => d.detail !== null);

  const cruiseIds = new Set(
    details.flatMap((d) =>
      d.detail.timeline.flatMap((t) => (t.kind === "port" ? [t.cruiseId] : []))
    )
  );
  const cruiseLabels = await loadCruiseLabels(userId, [...cruiseIds]);

  const records = new Map<string, PassportRecord>();
  const trackCountries = new Set<string>();
  for (const { code, detail } of details) {
    const airportsHere = new Set(detail.airports.map((a) => a.iata));
    for (const row of detail.timeline) {
      if (row.kind === "track") {
        trackCountries.add(code);
        continue;
      }
      const found = recordOf(row, cruiseLabels);
      if (!found) continue;
      const record = records.get(found.key) ?? {
        entry: found.entry,
        countries: new Set<string>(),
        airports: new Set<string>(),
      };
      record.countries.add(code);
      record.entry = {
        ...record.entry,
        date: dayOf(later(record.entry.date?.value ?? null, found.entry.date?.value ?? null)),
      };
      if (row.kind === "flight") {
        for (const iata of [row.depIata, row.arrIata]) {
          if (iata && airportsHere.has(iata)) record.airports.add(iata);
        }
      }
      records.set(found.key, record);
    }
  }
  return { passport, records: [...records.values()], trackCountries };
}

function requireAllTime(scope: EvidenceScope, key: string): void {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${key} evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
}

/**
 * The units of `expected` no returned row credits, each with its reason. A
 * unit whose only proof is location history says so; anything else would be a
 * disagreement between the passport and its drill-down, and is reported as
 * `notPerEntry` rather than hidden inside a row that does not prove it.
 */
function residual(
  expected: ReadonlySet<string>,
  credited: ReadonlySet<string>,
  isLocationHistory: (unit: string) => boolean
): Array<{ count: number; reason: UnattributedReason }> {
  const missing = [...expected].filter((unit) => !credited.has(unit));
  const history = missing.filter(isLocationHistory).length;
  const other = missing.length - history;
  return [
    ...(history > 0 ? [{ count: history, reason: "locationHistoryOnly" as const }] : []),
    ...(other > 0 ? [{ count: other, reason: "notPerEntry" as const }] : []),
  ];
}

function distinctResponse(
  key: string,
  unit: string,
  value: number,
  scope: EvidenceScope,
  page: PagingParams,
  entries: EvidenceEntry[],
  unattributed: EvidenceResponse["unattributed"]
): EvidenceResponse {
  const paged = pageDistinctEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key,
      aggregation: "distinct",
      label: { key: `evidence.metric.${key}` },
      unit,
      value,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
    unattributed,
    page,
  };
}

/** `summary.countries` — the headline, counted from the rows at the user's threshold. */
export async function resolvePassportCountryCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "passportCountryCount");
  const { passport, records, trackCountries } = await loadPassportEvidenceIndex(userId);
  const counted = new Set(passport.countries.filter((c) => c.counted).map((c) => c.code));
  const entries = records
    .map((r) => ({ ...r.entry, credits: [...r.countries].filter((c) => counted.has(c)).sort() }))
    .filter((e) => e.credits.length > 0);
  const credited = new Set(entries.flatMap((e) => e.credits));
  return distinctResponse(
    "passportCountryCount",
    "countries",
    passport.summary.countries,
    scope,
    page,
    entries,
    residual(counted, credited, (code) => trackCountries.has(code))
  );
}

/** `summary.continentsVisited` — every country row's continent, whatever its tier. */
export async function resolvePassportContinentCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "passportContinentCount");
  const { passport, records, trackCountries } = await loadPassportEvidenceIndex(userId);
  const continentOf = new Map(passport.countries.map((c) => [c.code, c.continent]));
  const entries = records
    .map((r) => ({
      ...r.entry,
      credits: [
        ...new Set(
          [...r.countries].flatMap((code) => {
            const continent = continentOf.get(code);
            return continent ? [continent] : [];
          })
        ),
      ].sort(),
    }))
    .filter((e) => e.credits.length > 0);
  const visited = new Set(
    passport.countries.flatMap((c) => (c.continent ? [c.continent as string] : []))
  );
  const credited = new Set(entries.flatMap((e) => e.credits));
  // A continent is location history only when every country that puts it in
  // the passport is.
  const historyOnly = (continent: string): boolean =>
    passport.countries
      .filter((c) => c.continent === continent)
      .every((c) => trackCountries.has(c.code));
  return distinctResponse(
    "passportContinentCount",
    "continents",
    passport.summary.continentsVisited,
    scope,
    page,
    entries,
    residual(visited, credited, historyOnly)
  );
}

/** `summary.airports` — airports of flown legs whose country the catalogue knows. */
export async function resolvePassportAirportCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "passportAirportCount");
  const { passport, records } = await loadPassportEvidenceIndex(userId);
  const entries = records
    .filter((r) => r.entry.domain === "flight" && r.airports.size > 0)
    .map((r) => ({ ...r.entry, credits: [...r.airports].sort() }));
  const credited = new Set(entries.flatMap((e) => e.credits));
  return distinctResponse(
    "passportAirportCount",
    "airports",
    passport.summary.airports,
    scope,
    page,
    entries,
    // `stamps` is the passport's own airport list — the set the figure counts.
    residual(new Set(passport.stamps.map((s) => s.iata)), credited, () => false)
  );
}

/**
 * `summary.entries` — "Einreisen": each flown flight once per country it
 * touched, so a leg between two countries contributes two and a domestic hop
 * one. The contribution is the number of passport countries whose drill-down
 * lists the flight, which is how the figure sums its rows.
 */
export async function resolvePassportEntryCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "passportEntryCount");
  const { passport, records } = await loadPassportEvidenceIndex(userId);
  const entries = records
    .filter((r) => r.entry.domain === "flight")
    .map((r) => ({ ...r.entry, contribution: r.countries.size }));
  const attributed = entries.reduce((sum, e) => sum + e.contribution, 0);
  const gap = passport.summary.entries - attributed;
  const paged = pageSumEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key: "passportEntryCount",
      aggregation: "sum",
      label: { key: "evidence.metric.passportEntryCount" },
      unit: "entries",
      value: passport.summary.entries,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, contribution: paged.omittedContribution },
    unattributed: gap > 0 ? [{ count: gap, reason: "notPerEntry" }] : [],
    page,
  };
}

/**
 * `ranking:passportCountry:<ISO>` — the flights behind ONE country's entries,
 * the `entries` figure of `/stats/countries/:code` (item 6). Keyed by the ISO
 * code that page and the passport use, not by the airport catalogue's country
 * NAME the flight distribution tile ranks by (`country:` — a different rule for
 * a different tile, which stays as it is). Counted by that page's own
 * derivation, so the number and the list are one computation.
 */
export async function resolvePassportCountryEntries(
  userId: string,
  code: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  // An ISO alpha-2 code and nothing else: the key is what a client builds from
  // a passport row's `code`, and a name here would be a second way in.
  if (!/^[A-Z]{2}$/.test(code)) return null;
  requireAllTime(scope, "passportCountry");
  const detail = detailFor(code, await loadCountryDetailInputs(userId));
  const entries: EvidenceEntry[] = (detail?.timeline ?? []).flatMap((row) => {
    if (row.kind !== "flight") return [];
    const found = recordOf(row, new Map());
    return found ? [{ ...found.entry, contribution: 1 }] : [];
  });
  const paged = pageSumEntries(entries, page);
  return {
    measure: {
      kind: "ranking",
      key: rankingKey("passportCountry", code),
      aggregation: "sum",
      label: { key: "evidence.ranking.passportCountry", values: { country: code } },
      unit: "flights",
      // Nothing proves the country: a valid key with nothing behind it is 0,
      // the same answer every measure gives an empty account.
      value: detail?.entries ?? 0,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, contribution: paged.omittedContribution },
    unattributed: [],
    page,
  };
}
