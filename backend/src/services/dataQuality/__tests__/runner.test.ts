/**
 * Re-running the checks is the normal case, so this suite is mostly about what
 * a SECOND run does.
 *
 * The unique index stops a duplicate row; these tests stop a duplicate
 * question — a flag reopened after the user said "this is fine", or a flag left
 * standing after the contradiction is gone. Both make an inbox something people
 * stop reading, and neither is visible in the schema.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

interface Row {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  kind: string;
  status: string;
  details: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  revision?: number;
}

let rows: Row[] = [];
let nextId = 1;

/**
 * What a `jsonb` column does to an object on the way in.
 *
 * Postgres does NOT keep the key order it was given: jsonb stores keys sorted
 * by length, then alphabetically. A plain JS object keeps insertion order, so a
 * mock that stored the object as handed to it would make the "writes nothing on
 * a second run" test below pass while the real thing wrote three rows every
 * run — which is exactly what happened, measured on a throwaway database before
 * `stableStringify` existed. The mock imitates the column, not the language.
 */
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, jsonbOrder(v)]));
  }
  return value;
}

jest.mock("../../../db", () => ({
  prisma: {
    dataQualityFlag: {
      findMany: jest.fn(async (args: { where: { userId: string } }) =>
        rows.filter((r) => r.userId === args.where.userId).map((r) => ({ ...r }))
      ),
      create: jest.fn(async (args: { data: Omit<Row, "id" | "createdAt" | "resolvedAt"> }) => {
        const row: Row = {
          ...args.data,
          details: jsonbOrder(args.data.details),
          id: `f${nextId++}`,
          createdAt: new Date("2026-09-02"),
          resolvedAt: null,
        };
        rows.push(row);
        return { ...row };
      }),
      // Every runner write is conditional on the revision it read: `{ id,
      // revision }` for one flag, `{ OR: [...] }` for the stale batch.
      updateMany: jest.fn(
        async (args: {
          where: { id?: string; revision?: number; OR?: { id: string; revision: number }[] };
          data: Partial<Row> & { revision?: { increment: number } };
        }) => {
          const matches = (r: Row, w: { id?: string; revision?: number }) =>
            r.id === w.id && (w.revision === undefined || (r.revision ?? 0) === w.revision);
          const hit = rows.filter((r) =>
            args.where.OR ? args.where.OR.some((w) => matches(r, w)) : matches(r, args.where)
          );
          for (const row of hit) {
            const { revision, ...data } = args.data;
            Object.assign(row, data);
            if (revision) row.revision = (row.revision ?? 0) + revision.increment;
            if ("details" in data) row.details = jsonbOrder(data.details);
          }
          return { count: hit.length };
        }
      ),
      count: jest.fn(
        async (args: { where: { userId: string; status: string } }) =>
          rows.filter((r) => r.userId === args.where.userId && r.status === args.where.status)
            .length
      ),
    },
  },
}));

jest.mock("../gather", () => ({ loadAccountSnapshot: jest.fn() }));

import { loadAccountSnapshot } from "../gather";
import { runDataQualityChecks } from "../runner";
import { flight, snapshot } from "./recordFixtures";

const mockedSnapshot = loadAccountSnapshot as jest.MockedFunction<typeof loadAccountSnapshot>;

/**
 * What a fixture that is not about coordinates still has to carry.
 *
 * The lookup answers null everywhere and knows no codes, which is the neutral
 * setting rather than a disabled one: the boundary check abstains on every
 * record, so each fixture below keeps measuring the single thing it is about.
 */
const noCoordinates = () => ({
  locatedRecords: [],
  countryLookup: { countryAt: () => null, codes: new Set<string>() },
  // No time-model questions: the backfill check stays silent here.
  timeQuestions: [],
  homePeriods: [],
  // No travel records: the record checks (forgejo#282) stay silent here.
  records: {
    flights: [],
    railJourneys: [],
    busJourneys: [],
    ferryJourneys: [],
    cruises: [],
    stays: [],
    trips: [],
    knownAirportCodes: new Set<string>(),
    airportCatalogueEmpty: false,
    placeVisits: [],
  },
});

/** One house whose stay runs backwards — the least arguable finding there is. */
const reversedStay = (checkOut: string) => ({
  ...noCoordinates(),
  addressRecords: [],
  countryTouches: [],
  lodgingStays: [
    {
      id: "l1",
      stays: [{ id: "s1", checkIn: new Date("2024-09-03"), checkOut: new Date(checkOut) }],
    },
  ],
});

/**
 * The Hotel Sport case. Its details carry five keys whose insertion order and
 * whose jsonb order differ, which is what makes it the fixture that can see the
 * re-write bug — the reversed-stay one above cannot, because its keys happen to
 * come back in the order they went in.
 */
const mismatchedAddress = () => ({
  ...noCoordinates(),
  addressRecords: [
    {
      entityType: "lodging" as const,
      id: "l1",
      address: "Grajska cesta 2, 8222 Otočec, Slovenia",
      country: "Romania",
      isoCountryCode: "RO",
    },
  ],
  countryTouches: [],
  lodgingStays: [],
});

const cleanAccount = () => ({
  ...noCoordinates(),
  addressRecords: [],
  countryTouches: [],
  lodgingStays: [],
});

beforeEach(() => {
  rows = [];
  nextId = 1;
  jest.clearAllMocks();
});

describe("runDataQualityChecks", () => {
  it("opens a flag for a finding it has not seen", async () => {
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));

    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ opened: 1, open: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "u1", entityId: "l1", status: "open" });
  });

  it("writes nothing on a second run over unchanged data", async () => {
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");

    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ opened: 0, reopened: 0, updated: 0, autoResolved: 0, open: 1 });
    expect(rows).toHaveLength(1);
  });

  it("writes nothing on a second run when the column reorders the details' keys", async () => {
    // Measured before `stableStringify` existed: four unchanged flags produced
    // `updated: 3` on every run, because jsonb hands the keys back sorted by
    // length and a plain JSON.stringify comparison called that a change. Three
    // pointless writes per run, invisible to any mock that keeps insertion
    // order.
    mockedSnapshot.mockResolvedValue(mismatchedAddress());
    await runDataQualityChecks("u1");

    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ opened: 0, updated: 0, reopened: 0, autoResolved: 0 });
  });

  it("resolves a flag whose contradiction is gone", async () => {
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");

    mockedSnapshot.mockResolvedValue(cleanAccount());
    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ autoResolved: 1, open: 0 });
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].resolvedAt).not.toBeNull();
  });

  it("re-opens a resolved flag when the contradiction is still there", async () => {
    // "Resolved" means "I corrected the data". If it was not corrected, staying
    // quiet would turn the button into a way of hiding a fault.
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");
    rows[0].status = "resolved";
    rows[0].resolvedAt = new Date("2026-09-02");

    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ reopened: 1, open: 1 });
    expect(rows[0]).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("never re-opens a dismissed flag", async () => {
    // "This is not wrong, stop asking" is the escape hatch for a check that is
    // right about the disagreement and wrong about the conclusion. It has to be
    // permanent or it is not an escape hatch.
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");
    rows[0].status = "dismissed";

    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ opened: 0, reopened: 0, open: 0 });
    expect(rows[0].status).toBe("dismissed");
    expect(rows).toHaveLength(1);
  });

  it("refreshes the details of an open flag when they move", async () => {
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");

    mockedSnapshot.mockResolvedValue(reversedStay("2024-01-09"));
    const summary = await runDataQualityChecks("u1");

    expect(summary).toMatchObject({ updated: 1, opened: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({
      stays: [expect.objectContaining({ checkOut: "2024-01-09T00:00:00.000Z" })],
    });
  });

  it("resolves a flag whose record has been deleted", async () => {
    // The subject is polymorphic, so Postgres cannot cascade this away. An
    // orphan flag points at nothing a user can open, and the run is what clears
    // it.
    mockedSnapshot.mockResolvedValue(reversedStay("2024-03-09"));
    await runDataQualityChecks("u1");

    mockedSnapshot.mockResolvedValue(cleanAccount());
    await runDataQualityChecks("u1");

    expect(rows[0].status).toBe("resolved");
  });
});

/**
 * A dismissal answers ONE question: "this pair is fine", "these entries belong
 * to the trip". The flag's identity is only (entity, kind), so when the partner
 * or the set of entries changed, the dismissal silently swallowed a question
 * the user had never been asked.
 */
describe("runDataQualityChecks — what a dismissal covers", () => {
  const withRecords = (records: ReturnType<typeof snapshot>) => ({
    ...cleanAccount(),
    records,
  });
  const at = (iso: string) => new Date(iso);
  const outbound = (id: string, flightNumber: string) =>
    flight({
      id,
      flightNumber,
      departureAt: at("2026-03-10T08:00:00Z"),
      arrivalAt: at("2026-03-10T16:00:00Z"),
    });
  const later = flight({
    id: "later",
    flightNumber: "UA1",
    departureAt: at("2026-03-10T13:00:00Z"),
    arrivalAt: at("2026-03-10T15:00:00Z"),
  });
  const flagOf = (kind: string) => rows.find((r) => r.kind === kind);

  it("asks again when an overlap's partner is a different entry", async () => {
    mockedSnapshot.mockResolvedValue(
      withRecords(snapshot({ flights: [outbound("a", "LH400"), later] }))
    );
    await runDataQualityChecks("u1");
    flagOf("chronology_conflict")!.status = "dismissed";

    mockedSnapshot.mockResolvedValue(
      withRecords(snapshot({ flights: [outbound("c", "BA7"), later] }))
    );
    await runDataQualityChecks("u1");

    expect(flagOf("chronology_conflict")).toMatchObject({
      status: "open",
      details: { conflictWith: { entityId: "c" } },
    });
  });

  it("keeps an overlap dismissed while its partner stays the same", async () => {
    mockedSnapshot.mockResolvedValue(
      withRecords(snapshot({ flights: [outbound("a", "LH400"), later] }))
    );
    await runDataQualityChecks("u1");
    flagOf("chronology_conflict")!.status = "dismissed";

    const moved = { ...later, arrivalAt: at("2026-03-10T15:30:00Z") };
    mockedSnapshot.mockResolvedValue(
      withRecords(snapshot({ flights: [outbound("a", "LH400"), moved] }))
    );
    await runDataQualityChecks("u1");

    expect(flagOf("chronology_conflict")!.status).toBe("dismissed");
  });

  it("asks again when a trip gains another entry outside its days", async () => {
    const trip = {
      id: "t1",
      name: "Lisbon",
      status: "completed",
      startDay: "2026-03-09",
      endDay: "2026-03-15",
    };
    const away = (id: string, day: string) =>
      flight({
        id,
        flightNumber: id.toUpperCase(),
        tripId: "t1",
        firstDay: day,
        lastDay: day,
        departureAt: at(`${day}T08:00:00Z`),
        arrivalAt: at(`${day}T10:00:00Z`),
      });
    mockedSnapshot.mockResolvedValue(
      withRecords(snapshot({ trips: [trip], flights: [away("x1", "2026-03-20")] }))
    );
    await runDataQualityChecks("u1");
    flagOf("trip_entries_outside")!.status = "dismissed";

    // Same entry, another run: the answer still covers it.
    await runDataQualityChecks("u1");
    expect(flagOf("trip_entries_outside")!.status).toBe("dismissed");

    mockedSnapshot.mockResolvedValue(
      withRecords(
        snapshot({ trips: [trip], flights: [away("x1", "2026-03-20"), away("x2", "2026-03-25")] })
      )
    );
    await runDataQualityChecks("u1");
    expect(flagOf("trip_entries_outside")!.status).toBe("open");
  });
});
