import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { fakeUtcToInstant } from "../../shared/time/legacyValues";
import type { TimePrecision } from "../../shared/time/wire";
import { iso, ledgeredRowIds, placeZone, writeRows, type LedgerEntry, type RowWrite } from "./core";

/**
 * Flights (ADR 0002 phase 3b). A flight gets the zone of each end — the
 * airport catalogue by IATA, then ICAO, then the stored coordinates, `0,0`
 * being no position — and a precision per end from its semantics tag:
 *
 * | tag | instant | precision |
 * |---|---|---|
 * | `UTC` | kept, it is one | minute |
 * | `LEGACY_FAKE_UTC` | its wall clock read at the airport (ledger only, the legacy column stays until phase 6) | minute; a wall clock the zone skipped → unknown, open |
 * | `DATE_ONLY` | kept (a noon placeholder) | day; open when the airport's local day is not the UTC day |
 * | `UNKNOWN` | kept | unknown, open — never classified, so not read as either |
 *
 * The plan listed `UNKNOWN` beside `UTC` at precision minute; that would be
 * the guess this phase forbids, and it is also what the phase-2 write path
 * already stores (`precisionOf`), so the two agree.
 */

type End = "dep" | "arr";

interface FlightRow {
  id: string;
  userId: string;
  depIata: string | null;
  depIcao: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrIcao: string | null;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
}

/** Active airports first, then closed ones — a code can name both. */
export async function catalogueZones(
  rows: Array<Pick<FlightRow, "depIata" | "depIcao" | "arrIata" | "arrIcao">>
): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const r of rows) {
    for (const code of [r.depIata, r.depIcao, r.arrIata, r.arrIcao]) {
      if (code) codes.add(code.toUpperCase());
    }
  }
  if (codes.size === 0) return new Map();
  const airports = await prisma.airport.findMany({
    where: { OR: [{ iata: { in: [...codes] } }, { icao: { in: [...codes] } }] },
    select: { iata: true, icao: true, timezone: true, isClosed: true },
    orderBy: [{ isClosed: "asc" }, { id: "asc" }],
  });
  const zones = new Map<string, string>();
  for (const a of airports) {
    if (!a.timezone) continue;
    for (const key of [a.iata ? `iata:${a.iata}` : null, a.icao ? `icao:${a.icao}` : null]) {
      if (key && !zones.has(key)) zones.set(key, a.timezone);
    }
  }
  return zones;
}

interface EndResult {
  zone: string | null;
  precision: TimePrecision | null;
  entry: LedgerEntry;
}

/** An airport end as the resolver reads it: catalogue by IATA, then ICAO, then coordinates. */
export function flightEndPlace(
  row: Pick<
    FlightRow,
    "depIata" | "depIcao" | "arrIata" | "arrIcao" | "depLat" | "depLon" | "arrLat" | "arrLon"
  >,
  end: End,
  catalogue: Map<string, string>
): { catalogueZone: string | null; lat: number; lon: number } {
  const iata = (end === "dep" ? row.depIata : row.arrIata)?.toUpperCase();
  const icao = (end === "dep" ? row.depIcao : row.arrIcao)?.toUpperCase();
  const catalogueZone =
    (iata ? catalogue.get(`iata:${iata}`) : undefined) ??
    (icao ? catalogue.get(`icao:${icao}`) : undefined) ??
    null;
  return {
    catalogueZone,
    lat: end === "dep" ? row.depLat : row.arrLat,
    lon: end === "dep" ? row.depLon : row.arrLon,
  };
}

function readEnd(row: FlightRow, end: End, catalogue: Map<string, string>): EndResult {
  const place = placeZone(flightEndPlace(row, end, catalogue));
  const time = end === "dep" ? row.departureTime : row.arrivalTime;
  const semantics = end === "dep" ? row.depTimeSemantics : row.arrTimeSemantics;
  const columnName = end === "dep" ? "departure" : "arrival";
  const base = { columnName, legacyValue: iso(time), zone: place.zone };

  if (!time) {
    return {
      zone: place.zone,
      precision: null,
      entry: { ...base, newValue: null, rule: "flight.no_time", reason: null },
    };
  }
  if (semantics === "LEGACY_FAKE_UTC") return fakeUtcEnd(time, place.zone, place.reason, base);
  if (semantics === "DATE_ONLY") {
    const differs = place.zone !== null && localDay(time, place.zone) !== iso(time)!.slice(0, 10);
    return {
      zone: place.zone,
      precision: "day",
      entry: {
        ...base,
        newValue: iso(time),
        rule: "flight.date_only",
        reason: place.reason ?? (differs ? "date_only_day_differs" : null),
      },
    };
  }
  if (semantics !== "UTC") {
    return {
      zone: place.zone,
      precision: "unknown",
      entry: {
        ...base,
        newValue: iso(time),
        rule: "flight.semantics_unknown",
        reason: place.reason ?? "semantics_unknown",
      },
    };
  }
  return {
    zone: place.zone,
    precision: "minute",
    entry: { ...base, newValue: iso(time), rule: "flight.instant_kept", reason: place.reason },
  };
}

function fakeUtcEnd(
  time: Date,
  zone: string | null,
  zoneReason: LedgerEntry["reason"],
  base: Pick<LedgerEntry, "columnName" | "legacyValue" | "zone">
): EndResult {
  if (!zone) {
    return {
      zone,
      precision: "unknown",
      entry: { ...base, newValue: null, rule: "flight.fake_utc", reason: zoneReason },
    };
  }
  const reading = fakeUtcToInstant(time, zone);
  if (reading.status === "nonexistent") {
    return {
      zone,
      precision: "unknown",
      entry: { ...base, newValue: null, rule: "flight.fake_utc", reason: "local_time_nonexistent" },
    };
  }
  return {
    zone,
    precision: "minute",
    entry: {
      ...base,
      newValue: iso(reading.utc),
      rule: reading.ambiguous ? "flight.fake_utc_fold_earlier" : "flight.fake_utc_converted",
      reason: null,
    },
  };
}

export async function backfillFlights() {
  const done = await ledgeredRowIds("flights");
  const rows = (
    await prisma.flight.findMany({
      where: { depTimezone: null, arrTimezone: null, depPrecision: null, arrPrecision: null },
      select: {
        id: true,
        userId: true,
        depIata: true,
        depIcao: true,
        depLat: true,
        depLon: true,
        arrIata: true,
        arrIcao: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
        arrivalTime: true,
        depTimeSemantics: true,
        arrTimeSemantics: true,
      },
      orderBy: { id: "asc" },
    })
  ).filter((r) => !done.has(r.id));
  const catalogue = await catalogueZones(rows);
  const writes: RowWrite[] = rows.map((row) => {
    const dep = readEnd(row, "dep", catalogue);
    const arr = readEnd(row, "arr", catalogue);
    return {
      rowId: row.id,
      userId: row.userId,
      data: {
        depTimezone: dep.zone,
        arrTimezone: arr.zone,
        depPrecision: dep.precision,
        arrPrecision: arr.precision,
      },
      entries: [dep.entry, arr.entry],
    };
  });
  return writeRows("flights", writes, (id, data) => prisma.flight.update({ where: { id }, data }));
}
