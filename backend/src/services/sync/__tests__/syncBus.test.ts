import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import * as instanceSettings from "../../instanceSettingsService";
import { drainFeed, registerUser, wipe } from "./syncFixtures";

/**
 * forgejo#180: bus rides join the Companion's change feed (migration
 * 20261010040000_sync_feed_bus). The phone already writes rides offline; until
 * now it never heard of one changed on the web. Rows are written directly —
 * the triggers do not care which path wrote them.
 */
const WITH_BUS = ["flight", "cruise", "lodging", "poi", "roadtrip", "rail", "rental", "bus"];
const quoted = (version: Date) => `"${version.toISOString()}"`;
const items = (list: Array<{ entity: string; id: string; op: string }>, entity: string) =>
  list.filter((item) => item.entity === entity).map((item) => `${item.op}:${item.id}`);

function createRide(userId: string, operator = "Kobus") {
  return prisma.busJourney.create({
    data: {
      userId,
      operator,
      depStationName: "Seoul Express Bus Terminal",
      depLat: 37.5045,
      depLon: 127.0049,
      depTimezone: "Asia/Seoul",
      arrStationName: "Sokcho Express Bus Terminal",
      arrLat: 38.1987,
      arrLon: 128.5868,
      arrTimezone: "Asia/Seoul",
      departureTime: new Date("2026-10-07T01:00:00Z"),
      arrivalTime: new Date("2026-10-07T03:30:00Z"),
      status: "completed",
    },
  });
}

describe("sync feed: bus rides (forgejo#180)", () => {
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

  it("hands a ride's create, edit and delete to an account that shows bus", async () => {
    const user = await registerUser("sync-bus-1", WITH_BUS);
    const start = await drainFeed(user);

    const ride = await createRide(user.id);
    await prisma.busJourney.update({ where: { id: ride.id }, data: { seat: "12" } });
    const gone = await createRide(user.id, "Other");
    await prisma.busJourney.delete({ where: { id: gone.id } });

    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "bus_journey").sort()).toEqual(
      [`upsert:${ride.id}`, `delete:${gone.id}`].sort()
    );
    const record = delta.items.find((item) => item.id === ride.id)?.record;
    expect(record?.seat).toBe("12");
    // The frozen road line is derived and fetched with the ride, not carried.
    expect(record).not.toHaveProperty("geometry");
  });

  it("keeps rides, and their tombstones, from an account that hides bus", async () => {
    const user = await registerUser("sync-bus-2", ["flight"]);
    const start = await drainFeed(user);
    const ride = await createRide(user.id);
    const gone = await createRide(user.id, "Other");
    await prisma.busJourney.delete({ where: { id: gone.id } });
    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "bus_journey")).toEqual([]);
    expect(delta.items.map((item) => item.id)).not.toContain(ride.id);
  });

  it("refuses a ride edit made on a version that has moved on", async () => {
    const user = await registerUser("sync-bus-3", WITH_BUS);
    const ride = await createRide(user.id);
    const read = ride.updatedAt;
    await prisma.busJourney.update({ where: { id: ride.id }, data: { notes: "web edit" } });

    const response = await request(app)
      .patch(`/api/v1/bus/${ride.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(read))
      .send({ notes: "phone edit" })
      .expect(409);
    expect(response.body).toMatchObject({ code: "VERSION_CONFLICT", entity: "bus_journey" });
    const stored = await prisma.busJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(stored.notes).toBe("web edit");
  });
});
