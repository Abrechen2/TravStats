import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { resolveCompanions } from "../../companionService";
import * as instanceSettings from "../../instanceSettingsService";
import { drainFeed, registerUser, wipe } from "./syncFixtures";

/**
 * The three record kinds migration 20261002172714 added to the change feed
 * (forgejo#141, owner 2026-10-02): rental bookings and trip expenses — two
 * domains that landed beside the feed and were invisible to the phone — and
 * the companion catalogue. Rows are written directly; the triggers do not care
 * which path wrote them, which is the point of putting them in the database.
 */

const ALL_DOMAINS = ["flight", "cruise", "lodging", "poi", "roadtrip", "rail", "rental"];
const quoted = (version: Date) => `"${version.toISOString()}"`;

const items = (list: Array<{ entity: string; id: string; op: string }>, entity: string) =>
  list.filter((item) => item.entity === entity).map((item) => `${item.op}:${item.id}`);

function createRental(userId: string, provider = "Testcar") {
  return prisma.rentalBooking.create({
    data: {
      userId,
      provider,
      pickupStationName: "Testport",
      pickupLat: 50.03,
      pickupLon: 8.57,
      pickupTimezone: "Europe/Berlin",
      returnStationName: "Testport",
      returnLat: 50.03,
      returnLon: 8.57,
      returnTimezone: "Europe/Berlin",
      pickupTime: new Date("2025-05-05T08:00:00Z"),
      returnTime: new Date("2025-05-07T08:00:00Z"),
      status: "completed",
    },
  });
}

describe("sync feed: rentals, trip expenses and the companion catalogue", () => {
  // The rental domain is beta-gated by an INSTANCE flag — one row every test
  // process on this database shares. Another suite switching it off mid-run
  // made two of these tests fail once (review, fix round 1). This suite now
  // reads its own answer instead of the shared row, and leaves the row alone.
  const realSettings = instanceSettings.getInstanceSettings;
  let settingsSpy: jest.SpyInstance;

  beforeAll(() => {
    settingsSpy = jest
      .spyOn(instanceSettings, "getInstanceSettings")
      .mockImplementation(async () => ({ ...(await realSettings()), betaFeaturesEnabled: true }));
  });
  beforeEach(wipe);
  afterAll(async () => {
    settingsSpy.mockRestore();
    await wipe();
    await prisma.$disconnect();
  });

  it("hands a rental's create, edit and delete to an account that shows rentals", async () => {
    const user = await registerUser("sync-rental-1", ALL_DOMAINS);
    const start = await drainFeed(user);

    const rental = await createRental(user.id);
    await prisma.rentalBooking.update({
      where: { id: rental.id },
      data: { vehicleDriven: "VW Golf" },
    });
    const gone = await createRental(user.id, "Other");
    await prisma.rentalBooking.delete({ where: { id: gone.id } });

    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "rental_booking").sort()).toEqual(
      [`upsert:${rental.id}`, `delete:${gone.id}`].sort()
    );
    const record = delta.items.find((item) => item.id === rental.id);
    expect(record?.record?.vehicleDriven).toBe("VW Golf");
  });

  it("does not depend on the shared instance flag another test process may switch", async () => {
    const before = (await realSettings()).betaFeaturesEnabled;
    await instanceSettings.updateInstanceSettings({ betaFeaturesEnabled: false });
    try {
      const user = await registerUser("sync-rental-flag", ALL_DOMAINS);
      const start = await drainFeed(user);
      const rental = await createRental(user.id);
      const delta = await drainFeed(user, start.cursor);
      expect(items(delta.items, "rental_booking")).toEqual([`upsert:${rental.id}`]);
    } finally {
      await instanceSettings.updateInstanceSettings({ betaFeaturesEnabled: before });
    }
  });

  it("keeps rentals, and their tombstones, from an account that hides the domain", async () => {
    const user = await registerUser("sync-rental-2", ["flight"]);
    const start = await drainFeed(user);

    const rental = await createRental(user.id);
    const gone = await createRental(user.id, "Other");
    await prisma.rentalBooking.delete({ where: { id: gone.id } });

    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "rental_booking")).toEqual([]);
    expect(delta.items.map((item) => item.id)).not.toContain(rental.id);
  });

  async function expensesOnTripAndRoadtrip(enabledDomains: string[]) {
    const user = await registerUser("sync-expense-1", enabledDomains);
    const start = await drainFeed(user);
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Lissabon" } });
    const route = await prisma.tripRoute.create({
      data: { userId: user.id, name: "Alpen", mode: "car", kind: "roadtrip" },
    });
    const onTrip = await prisma.tripExpense.create({
      data: { userId: user.id, tripId: trip.id, kind: "parking", amount: "12.40", currency: "EUR" },
    });
    const onRoute = await prisma.tripExpense.create({
      data: { userId: user.id, routeId: route.id, kind: "toll", amount: "8.00", currency: "EUR" },
    });
    const delta = await drainFeed(user, start.cursor);
    return { delta, onTrip, onRoute, carried: items(delta.items, "trip_expense") };
  }

  it("carries a trip's expense and a roadtrip's to an account that shows roadtrips", async () => {
    const { delta, onTrip, onRoute, carried } = await expensesOnTripAndRoadtrip(ALL_DOMAINS);

    expect(carried.sort()).toEqual([`upsert:${onTrip.id}`, `upsert:${onRoute.id}`].sort());
    // A Decimal reaches the phone as its exact string, never as 12.4000001.
    const record = delta.items.find((item) => item.id === onTrip.id)?.record;
    expect(record?.amount).toBe("12.4");
    expect(record).not.toHaveProperty("route");
  });

  it("keeps a roadtrip's expense from an account that hides roadtrips, not a trip's", async () => {
    const { onTrip, onRoute, carried } = await expensesOnTripAndRoadtrip(["flight"]);

    // A row the account may not see is answered as a delete — the feed's rule
    // for every per-row gate (`materialise` in changeFeed.ts): whatever the
    // phone holds of it must go. It is never handed over as a record.
    expect(carried).toContain(`upsert:${onTrip.id}`);
    expect(carried).not.toContain(`upsert:${onRoute.id}`);
  });

  it("hands over the companion catalogue, and a new spelling of the same person", async () => {
    const user = await registerUser("sync-companion-1", ALL_DOMAINS);
    const start = await drainFeed(user);

    const [anna] = await resolveCompanions(user.id, ["Anna"]);
    const first = await drainFeed(user, start.cursor);
    expect(items(first.items, "companion")).toEqual([`upsert:${anna!.id}`]);
    const record = first.items.find((item) => item.id === anna!.id)?.record;
    expect(record?.displayName).toBe("Anna");
    expect(record).not.toHaveProperty("searchName");

    await resolveCompanions(user.id, ["ANNA"]);
    const renamed = await drainFeed(user, first.cursor);
    expect(items(renamed.items, "companion")).toEqual([`upsert:${anna!.id}`]);
    expect(renamed.items[0]?.record?.displayName).toBe("ANNA");
  });

  it("refuses a rental edit made on a version that has moved on", async () => {
    const user = await registerUser("sync-rental-3", ALL_DOMAINS);
    const rental = await createRental(user.id);
    const read = rental.updatedAt;
    await prisma.rentalBooking.update({ where: { id: rental.id }, data: { notes: "web edit" } });

    const response = await request(app)
      .patch(`/api/v1/rentals/${rental.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(read))
      .send({ notes: "phone edit" })
      .expect(409);

    expect(response.body).toMatchObject({
      code: "VERSION_CONFLICT",
      entity: "rental_booking",
      changedFields: ["notes"],
    });
    const stored = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: rental.id } });
    expect(stored.notes).toBe("web edit");
  });

  it("refuses an expense delete made on a version that has moved on", async () => {
    const user = await registerUser("sync-expense-3", ALL_DOMAINS);
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Porto" } });
    const expense = await prisma.tripExpense.create({
      data: { userId: user.id, tripId: trip.id, kind: "parking", amount: "5.00", currency: "EUR" },
    });
    await prisma.tripExpense.update({ where: { id: expense.id }, data: { note: "web" } });

    await request(app)
      .delete(`/api/v1/trips/${trip.id}/expenses/${expense.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(expense.updatedAt))
      .expect(409);

    expect(await prisma.tripExpense.count({ where: { id: expense.id } })).toBe(1);
  });
});
