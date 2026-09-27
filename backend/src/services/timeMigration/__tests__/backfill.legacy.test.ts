import fs from "fs";
import path from "path";

import { prisma } from "../../../db";
import { fromDbDate } from "../../../shared/time/localDate";
import { runDataQualityChecks } from "../../dataQuality/runner";
import { listFlags } from "../../dataQuality/flagService";
import { buildTimeMigrationReport } from "../report";
import { runTimeModelBackfill } from "../runner";
import { createLegacyFixture, removeLegacyFixture, type LegacyFixture } from "./legacyFixture";

/**
 * The time-model backfill against rows written the way the app wrote them
 * before ADR 0002 (see `legacyFixture.ts`): what it converts, what it leaves
 * open and asks about, that it touches no legacy column, that the ledger holds
 * every value, that a second run changes nothing, and that the undo script
 * returns the new columns to empty.
 */

jest.setTimeout(120_000);

let fx: LegacyFixture | null = null;
const day = (value: Date | null): string | null => (value ? fromDbDate(value) : null);
const isoOf = (value: Date | null): string | null => (value ? value.toISOString() : null);

async function resetBackfillState(): Promise<void> {
  await prisma.timeMigrationLedger.deleteMany({});
  await prisma.adminSettings.updateMany({ data: { timeModelBackfillAt: null } });
}

/** Every legacy column the fixture wrote, to prove the backfill never touched one. */
async function legacySnapshot(userId: string): Promise<string> {
  const [flights, visits, stays, stops, trips, journal, user, rail, cruises] = await Promise.all([
    prisma.flight.findMany({
      where: { userId },
      select: { id: true, departureTime: true, arrivalTime: true, depTimeSemantics: true },
      orderBy: { id: "asc" },
    }),
    prisma.placeVisit.findMany({
      where: { userId },
      select: { id: true, visitedAt: true, writtenVia: true },
      orderBy: { id: "asc" },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: { id: true, checkIn: true, checkOut: true, checkInTime: true },
      orderBy: { id: "asc" },
    }),
    prisma.cruiseStop.findMany({
      where: { cruise: { userId } },
      select: { id: true, date: true, arrivalTime: true, departureTime: true },
      orderBy: { id: "asc" },
    }),
    prisma.trip.findMany({
      where: { userId },
      select: { id: true, startDate: true, endDate: true },
      orderBy: { id: "asc" },
    }),
    prisma.tripJournalEntry.findMany({
      where: { trip: { userId } },
      select: { id: true, date: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { birthdate: true } }),
    prisma.railJourney.findMany({
      where: { userId },
      select: { id: true, departureTime: true, depTimezone: true },
      orderBy: { id: "asc" },
    }),
    prisma.cruise.findMany({ where: { userId }, select: { startDate: true, endDate: true } }),
  ]);
  return JSON.stringify({ flights, visits, stays, stops, trips, journal, user, rail, cruises });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: "tmLegacyUser" } });
  await resetBackfillState();
  fx = await createLegacyFixture("tmLegacyUser");
});

afterAll(async () => {
  await removeLegacyFixture(fx);
  await resetBackfillState();
});

describe("the time-model backfill over legacy rows", () => {
  let legacyBefore = "";

  beforeAll(async () => {
    legacyBefore = await legacySnapshot(fx!.userId);
    await runTimeModelBackfill(new Date("2026-09-27T12:00:00.000Z"));
  });

  it("touches no legacy column", async () => {
    expect(await legacySnapshot(fx!.userId)).toBe(legacyBefore);
  });

  it("gives flights the zone of each airport and a precision from the semantics tag", async () => {
    const ids = fx!.ids;
    const rows = await prisma.flight.findMany({ where: { userId: fx!.userId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.flightUtc)).toMatchObject({
      depTimezone: "Europe/Berlin",
      arrTimezone: "America/New_York",
      depPrecision: "minute",
      arrPrecision: "minute",
    });
    expect(byId.get(ids.flightNoPosition)).toMatchObject({
      depTimezone: null,
      depPrecision: "minute",
    });
    expect(byId.get(ids.flightDateOnly)).toMatchObject({
      depTimezone: "Pacific/Kiritimati",
      depPrecision: "day",
    });
    expect(byId.get(ids.flightUnknown)).toMatchObject({ depPrecision: "unknown" });

    // A fake-UTC flight's instant lives in the ledger until phase 6.
    const fake = await prisma.timeMigrationLedger.findMany({
      where: { tableName: "flights", rowId: ids.flightFake },
      orderBy: { columnName: "desc" },
    });
    expect(fake.map((l) => [l.columnName, l.newValue, l.zone, l.rule])).toEqual([
      ["departure", "2019-06-01T01:00:00.000Z", "Asia/Tokyo", "flight.fake_utc_converted"],
      ["arrival", "2019-06-01T13:00:00.000Z", "Europe/Berlin", "flight.fake_utc_converted"],
    ]);
  });

  it("reads each place visit by its writer, and keeps only the day where the writer is unknown", async () => {
    const ids = fx!.ids;
    const visits = new Map(
      (await prisma.placeVisit.findMany({ where: { userId: fx!.userId } })).map((v) => [v.id, v])
    );
    expect(visits.get(ids.visitWeb)).toMatchObject({
      visitedAtUtc: new Date("2026-07-01T12:00:00.000Z"),
      visitedZone: "Europe/Rome",
      visitedPrecision: "minute",
    });
    expect(visits.get(ids.visitCompanion)).toMatchObject({
      visitedAtUtc: new Date("2026-09-12T08:15:42.123Z"),
      visitedPrecision: "minute",
    });
    expect(visits.get(ids.visitUnknown)).toMatchObject({
      visitedAtUtc: new Date("2026-09-12T22:00:00.000Z"),
      visitedPrecision: "unknown",
    });
  });

  it("reads day columns written on a non-UTC host, and leaves 10:00–11:59 open", async () => {
    const ids = fx!.ids;
    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: ids.stayBerlin } });
    expect([day(stay.checkInDate), day(stay.checkOutDate), stay.stayZone]).toEqual([
      "2026-07-10",
      "2026-07-12",
      "Europe/Berlin",
    ]);
    expect([isoOf(stay.checkInAt), isoOf(stay.checkOutAt)]).toEqual([
      "2026-07-10T13:00:00.000Z",
      "2026-07-12T09:00:00.000Z",
    ]);
    const nowhere = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: ids.stayNowhere } });
    expect([day(nowhere.checkInDate), nowhere.checkInAt, nowhere.stayZone]).toEqual([
      "2026-05-01",
      null,
      null,
    ]);

    const typed = await prisma.trip.findUniqueOrThrow({ where: { id: ids.tripTyped } });
    expect([day(typed.startDay), day(typed.endDay), typed.startZone]).toEqual([
      "2026-05-01",
      "2026-05-07",
      null,
    ]);
    const journal = await prisma.tripJournalEntry.findUniqueOrThrow({
      where: { id: ids.journalAmbiguous },
    });
    expect(day(journal.day)).toBe("2026-05-02");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx!.userId } });
    expect([day(user.birthDay), user.birthPrecision]).toEqual(["1985-03-14", "day"]);
  });

  it("dates a trip filled from its flight by the local days at the airports", async () => {
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: fx!.ids.tripSegment } });
    expect([day(trip.startDay), trip.startZone, day(trip.endDay), trip.endZone]).toEqual([
      "2027-05-01",
      "America/New_York",
      "2027-05-02",
      "Europe/Berlin",
    ]);
  });

  it("converts port calls at the port's zone and leaves sea days and unresolved ports without one", async () => {
    const ids = fx!.ids;
    const stops = new Map(
      (await prisma.cruiseStop.findMany({ where: { cruiseId: ids.cruise } })).map((s) => [s.id, s])
    );
    const port = stops.get(ids.stopPort)!;
    expect([
      port.stopZone,
      isoOf(port.departureUtc),
      day(port.stopDate),
      port.timePrecision,
    ]).toEqual(["Europe/Berlin", "2026-06-01T15:00:00.000Z", "2026-06-01", "minute"]);
    expect(stops.get(ids.stopSeaDay)).toMatchObject({ stopZone: null, timePrecision: "day" });
    expect(stops.get(ids.stopSeaDayTime)).toMatchObject({
      stopZone: null,
      arrivalUtc: null,
      timePrecision: "unknown",
    });
    expect(stops.get(ids.stopUnresolved)).toMatchObject({
      stopZone: null,
      timePrecision: "unknown",
    });
    const cruise = await prisma.cruise.findUniqueOrThrow({ where: { id: ids.cruise } });
    expect([day(cruise.startDay), day(cruise.endDay), cruise.startZone]).toEqual([
      "2026-06-01",
      "2026-06-08",
      "Europe/Berlin",
    ]);
  });

  it("converts trip stops at their coordinates and asks about one without", async () => {
    const ids = fx!.ids;
    const timed = await prisma.tripStop.findUniqueOrThrow({ where: { id: ids.tripStopTimed } });
    expect([isoOf(timed.startUtc), isoOf(timed.endUtc), timed.stopZone, timed.precision]).toEqual([
      "2026-05-03T08:00:00.000Z",
      "2026-05-03T11:00:00.000Z",
      "Europe/Rome",
      "minute",
    ]);
    const nowhere = await prisma.tripStop.findUniqueOrThrow({ where: { id: ids.tripStopNowhere } });
    expect([nowhere.stopZone, nowhere.precision]).toEqual([null, "unknown"]);
  });

  it("marks rail precision, and a ride stored without its zone as unknown", async () => {
    const rows = new Map(
      (await prisma.railJourney.findMany({ where: { userId: fx!.userId } })).map((r) => [r.id, r])
    );
    expect(rows.get(fx!.ids.railZoned)).toMatchObject({
      depPrecision: "minute",
      arrPrecision: "minute",
    });
    expect(rows.get(fx!.ids.railUnzoned)).toMatchObject({
      depPrecision: "unknown",
      arrPrecision: "unknown",
    });
  });

  it("holds every converted value in the ledger", async () => {
    const ids = fx!.ids;
    const ledger = await prisma.timeMigrationLedger.findMany({ where: { userId: fx!.userId } });
    const newValues = new Set(ledger.map((l) => `${l.rowId} ${l.newValue}`));
    const instants: Array<[string, Date | null]> = [];
    for (const v of await prisma.placeVisit.findMany({ where: { userId: fx!.userId } })) {
      instants.push([v.id, v.visitedAtUtc]);
    }
    for (const s of await prisma.cruiseStop.findMany({ where: { cruiseId: ids.cruise } })) {
      instants.push([s.id, s.arrivalUtc], [s.id, s.departureUtc]);
    }
    for (const s of await prisma.tripStop.findMany({ where: { tripId: ids.tripTyped } })) {
      instants.push([s.id, s.startUtc], [s.id, s.endUtc]);
    }
    for (const s of await prisma.lodgingStay.findMany({ where: { userId: fx!.userId } })) {
      instants.push([s.id, s.checkInAt], [s.id, s.checkOutAt]);
    }
    const missing = instants
      .filter(([, v]) => v !== null)
      .map(([id, v]) => `${id} ${v!.toISOString()}`)
      .filter((key) => !newValues.has(key));
    expect(missing).toEqual([]);
    // Every row the fixture wrote is in the ledger.
    const rowsInLedger = new Set(ledger.map((l) => l.rowId));
    expect(Object.entries(ids).filter(([k, id]) => k !== "place" && !rowsInLedger.has(id))).toEqual(
      []
    );
  });

  it("asks the user about every row it could not decide, one flag per row and kind", async () => {
    const flags = await listFlags(fx!.userId, { status: "open" });
    const asked = flags
      .filter((f) => f.kind.startsWith("time_"))
      .map((f) => `${f.entityType}:${f.entityId}:${f.kind}`)
      .sort();
    const ids = fx!.ids;
    expect(asked).toEqual(
      [
        `flight:${ids.flightNoPosition}:time_zone_unresolved`,
        `flight:${ids.flightDateOnly}:time_day_ambiguous`,
        `flight:${ids.flightUnknown}:time_precision_unknown`,
        `rail_journey:${ids.railUnzoned}:time_precision_unknown`,
        `place_visit:${ids.visitUnknown}:time_precision_unknown`,
        `lodging_stay:${ids.stayNowhere}:time_zone_unresolved`,
        `cruise_stop:${ids.stopSeaDayTime}:time_precision_unknown`,
        `cruise_stop:${ids.stopUnresolved}:time_zone_unresolved`,
        `trip:${ids.tripTyped}:time_day_ambiguous`,
        `trip_journal_entry:${ids.journalAmbiguous}:time_day_ambiguous`,
        `trip_stop:${ids.tripStopNowhere}:time_zone_unresolved`,
      ].sort()
    );
  });

  it("reports every open row with its reason, and nothing it converted as open", async () => {
    const report = await buildTimeMigrationReport();
    const mine = new Set(Object.values(fx!.ids));
    const open = report.openRows
      .filter((r) => mine.has(r.rowId))
      .map((r) => `${r.table}.${r.column}:${r.reason}`)
      .sort();
    expect(open).toEqual(
      [
        "cruise_stops.arrival_time:port_unresolved",
        "cruise_stops.arrival_time:sea_day_time",
        "flights.departure:date_only_day_differs",
        "flights.departure:no_position",
        "flights.departure:semantics_unknown",
        "lodging_stays.check_in_time:no_position",
        "rail_journeys.arrival:instant_without_zone",
        "rail_journeys.departure:instant_without_zone",
        "trip_journal_entries.date:day_anchor_ambiguous",
        "trip_stops.start_date:no_position",
        "trips.end_date:day_anchor_ambiguous",
        "place_visits.visited_at:writer_unknown",
      ].sort()
    );
    expect(report.backfill.state).toBe("completed");
  });

  it("answers a question once the row is fixed, through the ordinary data-quality run", async () => {
    await prisma.flight.update({
      where: { id: fx!.ids.flightNoPosition },
      data: { depTimezone: "Europe/Berlin" },
    });
    await runDataQualityChecks(fx!.userId);
    const flags = await listFlags(fx!.userId, { status: "open" });
    expect(flags.some((f) => f.entityId === fx!.ids.flightNoPosition)).toBe(false);
  });

  it("changes nothing on a second run", async () => {
    const snapshot = async () =>
      JSON.stringify({
        ledger: await prisma.timeMigrationLedger.count(),
        visits: await prisma.placeVisit.findMany({
          where: { userId: fx!.userId },
          orderBy: { id: "asc" },
          select: { visitedAtUtc: true, visitedZone: true, visitedPrecision: true },
        }),
        flights: await prisma.flight.findMany({
          where: { userId: fx!.userId },
          orderBy: { id: "asc" },
          select: { depTimezone: true, arrTimezone: true, depPrecision: true, arrPrecision: true },
        }),
        stops: await prisma.cruiseStop.findMany({
          where: { cruiseId: fx!.ids.cruise },
          orderBy: { id: "asc" },
          select: { stopZone: true, arrivalUtc: true, stopDate: true, timePrecision: true },
        }),
      });
    const before = await snapshot();
    const second = await runTimeModelBackfill();
    expect(second.tables.every((t) => t.converted === 0)).toBe(true);
    expect(await snapshot()).toBe(before);
  });

  it("is undone by undo-backfill.sql, which leaves the legacy columns and the ledger", async () => {
    const file = path.resolve(
      __dirname,
      "../../../../prisma/migrations/20260927014000_time_model_backfill_marker/undo-backfill.sql"
    );
    const statements = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const ledgerBefore = await prisma.timeMigrationLedger.count();
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    const visit = await prisma.placeVisit.findUniqueOrThrow({ where: { id: fx!.ids.visitWeb } });
    expect([visit.visitedAtUtc, visit.visitedZone, visit.visitedPrecision]).toEqual([
      null,
      null,
      null,
    ]);
    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: fx!.ids.stayBerlin } });
    expect([stay.checkInDate, stay.checkInAt, stay.stayZone]).toEqual([null, null, null]);
    expect(await prisma.timeMigrationLedger.count()).toBe(ledgerBefore);
    // `legacyBefore` was taken before the backfill: the undo leaves it as it was.
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: fx!.ids.flightUtc } });
    expect(flight.depTimezone).toBeNull();
    expect(await legacySnapshot(fx!.userId)).toBe(legacyBefore);
  });
});
