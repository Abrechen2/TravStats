import fs from "fs";
import path from "path";

import { prisma } from "../db";
import { localDay } from "../shared/time/instant";

/**
 * Migration 20261121090000_date_only_flights_local_noon (GitHub #403) rewrites
 * rows, so it ships with this replay against rows in the OLD shape: a DATE_ONLY
 * end stored as midnight UTC, which read through a zone west of UTC lands on the
 * previous day. The file runs in a SCRATCH schema (statements are unqualified,
 * `search_path` aims them there), twice, to show it is idempotent.
 */

const FILE = path.join(
  __dirname,
  "../../prisma/migrations/20261121090000_date_only_flights_local_noon/migration.sql"
);
const SCHEMA = "migtest_date_only_noon";

const statements = (): string[] =>
  fs
    .readFileSync(FILE, "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

type Row = {
  id: string;
  dep: string;
  arr: string | null;
  dsem: string;
  asem: string;
  dtz: string | null;
  atz: string | null;
};

// id, departure, arrival, dep semantics, arr semantics, dep zone, arr zone
const ROWS: Row[] = [
  // the reporter's rows: midnight UTC, zone west of UTC
  {
    id: "sfo",
    dep: "2025-12-28T00:00:00Z",
    arr: "2025-12-28T00:00:00Z",
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "America/Los_Angeles",
    atz: "Pacific/Honolulu",
  },
  {
    id: "hnl",
    dep: "2025-12-31T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Pacific/Honolulu",
    atz: "Pacific/Honolulu",
  },
  // east of UTC: old shape too (reads right, but the column keeps one convention)
  {
    id: "lhr-muc",
    dep: "2026-01-13T00:00:00Z",
    arr: "2026-01-13T00:00:00Z",
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Europe/Berlin",
    atz: "Europe/Berlin",
  },
  // already the current convention: the form's noon and the cruise import's midnight
  {
    id: "form-noon",
    dep: "2025-12-28T20:00:00Z",
    arr: "2025-12-28T20:00:00Z",
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "America/Los_Angeles",
    atz: "America/Los_Angeles",
  },
  {
    id: "import-midnight",
    dep: "2026-05-10T04:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "America/New_York",
    atz: null,
  },
  // zones where midnight UTC IS the current convention (UTC+0 midnight, UTC+12 noon)
  {
    id: "london-winter",
    dep: "2026-01-13T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Europe/London",
    atz: null,
  },
  {
    id: "auckland-winter",
    dep: "2026-06-30T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Pacific/Auckland",
    atz: null,
  },
  // UTC-12 (uninhabited): local noon IS 00:00Z there, so it cannot be told from the old shape and is left alone
  {
    id: "gmt-12",
    dep: "2025-12-28T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Etc/GMT+12",
    atz: null,
  },
  // not touched: no zone, a zone Postgres does not know, and a real instant
  {
    id: "no-zone",
    dep: "2026-01-08T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: null,
    atz: null,
  },
  {
    id: "bad-zone",
    dep: "2026-01-08T00:00:00Z",
    arr: null,
    dsem: "DATE_ONLY",
    asem: "DATE_ONLY",
    dtz: "Not/AZone",
    atz: null,
  },
  {
    id: "real-instant",
    dep: "2026-01-08T00:00:00Z",
    arr: "2026-01-08T00:00:00Z",
    dsem: "UTC",
    asem: "UTC",
    dtz: "Pacific/Honolulu",
    atz: "Pacific/Honolulu",
  },
];

const iso = (v: unknown): string | null => (v ? (v as Date).toISOString() : null);

describe("migration 20261121090000 — date-only flights move to the local-noon convention (#403)", () => {
  let after: Record<string, { dep: string | null; arr: string | null }>;
  let afterSecondRun: typeof after;

  const read = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const rows = await tx.$queryRawUnsafe<
      Array<{ id: string; departure_time: Date | null; arrival_time: Date | null }>
    >(`SELECT id, departure_time, arrival_time FROM flights ORDER BY id`);
    return Object.fromEntries(
      rows.map((r) => [r.id, { dep: iso(r.departure_time), arr: iso(r.arrival_time) }])
    );
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}, public`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE flights (id TEXT PRIMARY KEY, departure_time TIMESTAMP(3), arrival_time TIMESTAMP(3),
           dep_time_semantics TEXT NOT NULL, arr_time_semantics TEXT NOT NULL,
           dep_timezone TEXT, arr_timezone TEXT)`
      );
      for (const r of ROWS) {
        await tx.$executeRawUnsafe(
          `INSERT INTO flights VALUES ($1, $2::timestamp, $3::timestamp, $4, $5, $6, $7)`,
          r.id,
          r.dep.replace("Z", ""),
          r.arr?.replace("Z", "") ?? null,
          r.dsem,
          r.asem,
          r.dtz,
          r.atz
        );
      }
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      after = await read(tx);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      afterSecondRun = await read(tx);
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("puts a midnight-UTC row west of UTC on its stored day at local noon (was the previous day)", () => {
    expect(after.sfo.dep).toBe("2025-12-28T20:00:00.000Z");
    expect(after.sfo.arr).toBe("2025-12-28T22:00:00.000Z");
    expect(after.hnl.dep).toBe("2025-12-31T22:00:00.000Z");
    expect(after.hnl.arr).toBeNull();
    // the day the web and every statistic read is the stored calendar date
    expect(localDay(new Date(after.sfo.dep!), "America/Los_Angeles")).toBe("2025-12-28");
    expect(localDay(new Date(after.hnl.dep!), "Pacific/Honolulu")).toBe("2025-12-31");
  });

  it("converts east-of-UTC old rows too, so the column holds one convention", () => {
    expect(after["lhr-muc"].dep).toBe("2026-01-13T11:00:00.000Z");
    expect(after["lhr-muc"].arr).toBe("2026-01-13T11:00:00.000Z");
  });

  it("leaves a UTC-12 row alone — converting it again on a re-run would walk it forward a day", () => {
    expect(after["gmt-12"].dep).toBe("2025-12-28T00:00:00.000Z");
  });

  it("leaves rows already in the current convention exactly as they were", () => {
    for (const id of ["form-noon", "import-midnight", "london-winter", "auckland-winter"]) {
      const row = ROWS.find((r) => r.id === id)!;
      expect(after[id].dep).toBe(new Date(row.dep).toISOString());
    }
  });

  it("does not guess for a row with no zone or an unknown zone, nor touch a real instant", () => {
    expect(after["no-zone"].dep).toBe("2026-01-08T00:00:00.000Z");
    expect(after["bad-zone"].dep).toBe("2026-01-08T00:00:00.000Z");
    expect(after["real-instant"].dep).toBe("2026-01-08T00:00:00.000Z");
    expect(after["real-instant"].arr).toBe("2026-01-08T00:00:00.000Z");
  });

  it("is idempotent", () => {
    expect(afterSecondRun).toEqual(after);
  });
});
