import { prisma } from "../../../db";
import { prismaColumnNames } from "../../openapi/prismaColumns";
import type { Prisma } from "../../../prisma";
import { SYNC_ENTITIES, columnToField } from "../entities";
import { changeLog, createFlight, registerUser, wipe } from "./syncFixtures";

/**
 * The tombstones come from database triggers (migration
 * 20261001193030_sync_change_feed), so every way a row can leave — a Prisma
 * delete, a deleteMany, an ON DELETE CASCADE three tables away, raw SQL —
 * writes one. `check:drift` cannot see a trigger; this suite is what replays
 * the hand-written half of that migration.
 */

const MODEL_OF_TABLE: Record<string, Prisma.ModelName> = {
  trips: "Trip",
  trip_journal_entries: "TripJournalEntry",
  flights: "Flight",
  rail_journeys: "RailJourney",
  bus_journeys: "BusJourney",
  cruises: "Cruise",
  cruise_stops: "CruiseStop",
  lodgings: "Lodging",
  lodging_stays: "LodgingStay",
  places: "Place",
  place_visits: "PlaceVisit",
  trip_routes: "TripRoute",
  trip_stops: "TripStop",
  documents: "Document",
  rental_bookings: "RentalBooking",
  trip_expenses: "TripExpense",
  companions: "Companion",
};

async function tombstonesFor(entity: string, ids: string[]) {
  return prisma.syncChange.findMany({
    where: { entity, entityId: { in: ids }, op: "delete" },
  });
}

describe("sync change triggers", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("every synced entity's table carries the change trigger, and no other table does", async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'AA_sync_change' ORDER BY c.relname`;
    expect(rows.map((row) => row.relname)).toEqual(
      SYNC_ENTITIES.map((entity) => entity.table).sort()
    );
  });

  it("names every synced column the way the Prisma model does", async () => {
    for (const entity of SYNC_ENTITIES) {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${entity.table}`;
      const fields = new Set(prismaColumnNames(MODEL_OF_TABLE[entity.table]));
      const unmapped = columns
        .map((column) => column.column_name)
        .filter((column) => !fields.has(columnToField(column)));
      expect({ table: entity.table, unmapped }).toEqual({ table: entity.table, unmapped: [] });
    }
  });

  it("writes a tombstone for a Prisma delete, a deleteMany and raw SQL", async () => {
    const user = await registerUser("sync-trig-1");
    const a = await createFlight(user.id);
    const b = await createFlight(user.id);
    const c = await createFlight(user.id);

    await prisma.flight.delete({ where: { id: a.id } });
    await prisma.flight.deleteMany({ where: { id: b.id } });
    await prisma.$executeRaw`DELETE FROM flights WHERE id = ${c.id}`;

    const tombstones = await tombstonesFor("flight", [a.id, b.id, c.id]);
    expect(tombstones.map((row) => row.entityId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(tombstones.every((row) => row.userId === user.id)).toBe(true);
  });

  it("writes owned tombstones for children an ON DELETE CASCADE removes", async () => {
    const user = await registerUser("sync-trig-2");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Rom" } });
    const entry = await prisma.tripJournalEntry.create({
      data: { tripId: trip.id, date: new Date("2026-05-01T00:00:00Z"), body: "Tag 1" },
    });
    const stop = await prisma.tripStop.create({ data: { tripId: trip.id, title: "Forum" } });
    const tour = await prisma.tripRoute.create({
      data: { userId: user.id, tripId: trip.id, name: "Stadtrunde", mode: "walk" },
    });
    const station = await prisma.tripStop.create({ data: { routeId: tour.id, title: "Station" } });
    const lodging = await prisma.lodging.create({ data: { userId: user.id, name: "Hotel" } });
    const stay = await prisma.lodgingStay.create({
      data: { lodgingId: lodging.id, userId: user.id },
    });
    const place = await prisma.place.create({
      data: { userId: user.id, name: "Kolosseum", lat: 41.89, lon: 12.49 },
    });
    const visit = await prisma.placeVisit.create({ data: { placeId: place.id, userId: user.id } });
    const cruise = await prisma.cruise.create({ data: { userId: user.id } });
    const cruiseStop = await prisma.cruiseStop.create({
      data: { cruiseId: cruise.id, dayNumber: 1, isAtSea: true },
    });
    const flight = await createFlight(user.id);
    const document = await prisma.document.create({
      data: {
        userId: user.id,
        storedName: "x.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        format: "pdf",
        flightId: flight.id,
      },
    });

    await prisma.trip.delete({ where: { id: trip.id } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
    await prisma.place.delete({ where: { id: place.id } });
    await prisma.cruise.delete({ where: { id: cruise.id } });
    await prisma.flight.delete({ where: { id: flight.id } });

    const expected: Array<[string, string]> = [
      ["trip_journal_entry", entry.id],
      ["trip_stop", stop.id],
      ["trip_route", tour.id],
      ["trip_stop", station.id],
      ["lodging_stay", stay.id],
      ["place_visit", visit.id],
      ["cruise_stop", cruiseStop.id],
      ["document", document.id],
    ];
    for (const [entity, id] of expected) {
      const [tombstone] = await tombstonesFor(entity, [id]);
      expect({ entity, id, owner: tombstone?.userId }).toEqual({ entity, id, owner: user.id });
    }
  });

  it("records an ON DELETE SET NULL as an update of the child", async () => {
    const user = await registerUser("sync-trig-3");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Wien" } });
    const flight = await createFlight(user.id, { tripId: trip.id });

    await prisma.trip.delete({ where: { id: trip.id } });

    const [update] = await prisma.syncChange.findMany({
      where: { entity: "flight", entityId: flight.id, op: "upsert" },
      orderBy: { seq: "desc" },
      take: 1,
    });
    expect(update.changedColumns).toEqual(expect.arrayContaining(["trip_id"]));
  });

  it("records nothing for a write that changes nothing", async () => {
    const user = await registerUser("sync-trig-4");
    const flight = await createFlight(user.id);
    const before = await changeLog(user.id);

    await prisma.$executeRaw`UPDATE flights SET dep_lat = dep_lat WHERE id = ${flight.id}`;

    expect(await changeLog(user.id)).toEqual(before);
  });

  it("moves updated_at forward on every real change, even within one millisecond", async () => {
    const user = await registerUser("sync-trig-5");
    const flight = await createFlight(user.id);
    const frozen = flight.updatedAt;

    // A write that keeps the stamp (two writes in one ms) and raw SQL that
    // never touches it: both would otherwise leave two states one version.
    await prisma.flight.update({
      where: { id: flight.id },
      data: { notes: "a", updatedAt: frozen },
    });
    const afterSameStamp = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    await prisma.$executeRaw`UPDATE flights SET notes = 'b' WHERE id = ${flight.id}`;
    const afterRaw = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });

    expect(afterSameStamp.updatedAt.getTime()).toBeGreaterThan(frozen.getTime());
    expect(afterRaw.updatedAt.getTime()).toBeGreaterThan(afterSameStamp.updatedAt.getTime());
  });

  it("records nothing when the account itself is deleted, and the deletion succeeds", async () => {
    const user = await registerUser("sync-trig-6");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Bye" } });
    await prisma.tripJournalEntry.create({
      data: { tripId: trip.id, date: new Date("2026-05-01T00:00:00Z"), body: "x" },
    });
    await createFlight(user.id);
    const recorded = await prisma.syncChange.count({ where: { userId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.syncChange.count({ where: { userId: user.id, op: "delete" } })).toBe(0);
    expect(await prisma.syncChange.count({ where: { userId: user.id } })).toBe(recorded);
  });
});
