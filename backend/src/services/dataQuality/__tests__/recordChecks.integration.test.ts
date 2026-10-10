/**
 * The record checks (forgejo#282) end to end, against real Postgres: what the
 * gather reads from each table, what the runner writes, what the inbox serves
 * — and that a second run over unchanged data writes nothing, because a jsonb
 * column that reorders `details` would otherwise re-write every flag each run.
 */
import { prisma } from "../../../db";
import { listFlags, dismissFlag } from "../flagService";
import { runDataQualityChecks } from "../runner";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const FLIGHT = {
  airline: "Lufthansa",
  flightNumber: "LH400",
  depIata: "FRA",
  depLat: 50.03,
  depLon: 8.57,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  status: "flown",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  depTimezone: "Europe/Berlin",
  arrTimezone: "America/New_York",
};

const BUS = {
  depStationName: "ZOB Berlin",
  depLat: 52.5,
  depLon: 13.28,
  arrStationName: "Hamburg ZOB",
  arrLat: 53.55,
  arrLon: 10.01,
  departureTime: new Date("2026-05-02T06:00:00Z"),
  depTimezone: "Europe/Berlin",
  status: "completed",
};

async function seed(userId: string) {
  const trip = await prisma.trip.create({
    data: { userId, name: "Open end", status: "in_progress", startDay: day("2026-01-05") },
  });
  const typed = await prisma.flight.create({
    data: {
      ...FLIGHT,
      userId,
      tripId: trip.id,
      dataSource: "manual",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      departureTime: new Date("2026-03-10T08:00:00Z"),
      arrivalTime: new Date("2026-03-10T16:00:00Z"),
    },
  });
  const mail = await prisma.flight.create({
    data: {
      ...FLIGHT,
      userId,
      dataSource: "email_import",
      createdAt: new Date("2026-03-02T00:00:00Z"),
      departureTime: new Date("2026-03-10T08:00:00Z"),
      arrivalTime: new Date("2026-03-10T16:00:00Z"),
    },
  });
  // The same flight the next day: a commute, not a copy.
  await prisma.flight.create({
    data: {
      ...FLIGHT,
      userId,
      departureTime: new Date("2026-03-11T08:00:00Z"),
      arrivalTime: new Date("2026-03-11T16:00:00Z"),
    },
  });
  const mystery = await prisma.flight.create({
    data: {
      ...FLIGHT,
      userId,
      airline: "Condor",
      flightNumber: null,
      arrIata: "XQZ",
      departureTime: new Date("2026-04-01T08:00:00Z"),
      arrivalTime: new Date("2026-04-01T12:00:00Z"),
    },
  });

  await prisma.busJourney.create({ data: { ...BUS, userId, createdAt: new Date("2026-04-01") } });
  const busCopy = await prisma.busJourney.create({
    data: { ...BUS, userId, createdAt: new Date("2026-04-02") },
  });

  const rome = await prisma.lodging.create({ data: { userId, name: "Albergo Roma" } });
  const naples = await prisma.lodging.create({ data: { userId, name: "Hotel Napoli" } });
  await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: rome.id,
      checkIn: day("2026-06-10"),
      checkOut: day("2026-06-13"),
      checkInDate: day("2026-06-10"),
      checkOutDate: day("2026-06-13"),
    },
  });
  const naplesStay = await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: naples.id,
      checkIn: day("2026-06-12"),
      checkOut: day("2026-06-14"),
      checkInDate: day("2026-06-12"),
      checkOutDate: day("2026-06-14"),
    },
  });
  // A dated trip with two visits to the Colosseum: one on its days, one a
  // month later. Only the second is asked about. The day comes from the
  // visit's own zone (`visitLocalDay`): 23:30 UTC is already the next day in Rome.
  const tour = await prisma.trip.create({
    data: {
      userId,
      name: "Rom",
      status: "completed",
      startDay: day("2026-07-01"),
      endDay: day("2026-07-05"),
    },
  });
  const colosseum = await prisma.place.create({
    data: { userId, name: "Kolosseum", lat: 41.89, lon: 12.49 },
  });
  const visitAt = (utc: string) => ({
    userId,
    placeId: colosseum.id,
    tripId: tour.id,
    visitedAtUtc: new Date(utc),
    visitedZone: "Europe/Rome",
    visitedPrecision: "minute",
  });
  await prisma.placeVisit.create({ data: visitAt("2026-07-06T09:00:00Z") });
  const lateVisit = await prisma.placeVisit.create({ data: visitAt("2026-08-01T23:30:00Z") });
  return { trip, typed, mail, mystery, busCopy, naples, naplesStay, tour, colosseum, lateVisit };
}

describe("record checks against real Postgres", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-records-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("raises each question once, names its subject, and is idempotent", async () => {
    const rows = await seed(userId);

    const first = await runDataQualityChecks(userId, NOW);
    const flags = await listFlags(userId);
    const asked = flags.map((f) => `${f.kind} ${f.entityType} ${f.entityId}`).sort();

    expect(asked).toEqual(
      [
        `airport_unknown flight ${rows.mystery.id}`,
        `chronology_conflict lodging_stay ${rows.naplesStay.id}`,
        `duplicate_candidate bus_journey ${rows.busCopy.id}`,
        `duplicate_candidate flight ${rows.mail.id}`,
        `flight_number_missing flight ${rows.mystery.id}`,
        `trip_end_missing trip ${rows.trip.id}`,
        `trip_entries_outside trip ${rows.tour.id}`,
      ].sort()
    );
    expect(first.opened).toBe(7);
    const outside = flags.find((f) => f.kind === "trip_entries_outside");
    expect(outside?.details).toMatchObject({
      entries: [
        {
          entityType: "place_visit",
          entityId: rows.lateVisit.id,
          parentId: rows.colosseum.id,
          firstDay: "2026-08-02",
        },
      ],
    });

    const bus = flags.find((f) => f.entityType === "bus_journey");
    expect(bus?.subject).toMatchObject({ label: "ZOB Berlin → Hamburg ZOB", parentId: null });
    const stayFlag = flags.find((f) => f.kind === "chronology_conflict");
    expect(stayFlag?.subject).toMatchObject({ label: "Hotel Napoli", parentId: rows.naples.id });
    const dup = flags.find((f) => f.kind === "duplicate_candidate" && f.entityType === "flight");
    expect(dup?.details).toMatchObject({
      dataSource: "email_import",
      copies: [{ entityId: rows.typed.id, dataSource: "manual" }],
    });

    const second = await runDataQualityChecks(userId, NOW);
    expect(second).toMatchObject({ opened: 0, reopened: 0, updated: 0, autoResolved: 0, open: 7 });
  });

  it("keeps a dismissed duplicate dismissed, and resolves it when the copy is deleted", async () => {
    const rows = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const dup = (await listFlags(userId, { kind: "duplicate_candidate" })).find(
      (f) => f.entityType === "flight"
    );
    if (!dup) throw new Error("expected the flight's duplicate question");
    await dismissFlag(dup.id, userId);
    await runDataQualityChecks(userId, NOW);
    const dismissed = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: dup.id } });
    expect(dismissed.status).toBe("dismissed");

    // The safe path: delete the copy. The other flag of the same kind (the
    // bus) is untouched; the flight's question is gone with its row.
    await prisma.flight.delete({ where: { id: rows.mail.id } });
    const summary = await runDataQualityChecks(userId, NOW);
    expect(summary.opened).toBe(0);
    const open = await listFlags(userId, { kind: "duplicate_candidate" });
    expect(open.map((f) => f.entityType)).toEqual(["bus_journey"]);
  });
});
