import { prisma } from "../../../db";
import * as instanceSettings from "../../instanceSettingsService";
import { drainFeed, registerUser, wipe } from "./syncFixtures";

/**
 * Ferry crossings join the Companion's change feed (migration
 * 20261016090000_sync_feed_ferry), as bus rides did in forgejo#180. The domain
 * landed after the feed, so a crossing created or edited on the web never
 * reached the phone. Rows are written directly — the triggers do not care
 * which path wrote them.
 */
const WITH_FERRY = ["flight", "cruise", "lodging", "poi", "ferry"];
const items = (list: Array<{ entity: string; id: string; op: string }>, entity: string) =>
  list.filter((item) => item.entity === entity).map((item) => `${item.op}:${item.id}`);

function createCrossing(userId: string, operator = "Stena Line") {
  return prisma.ferryJourney.create({
    data: {
      userId,
      operator,
      depStationName: "Kiel",
      depLat: 54.3233,
      depLon: 10.1394,
      depTimezone: "Europe/Berlin",
      arrStationName: "Göteborg",
      arrLat: 57.7089,
      arrLon: 11.9746,
      arrTimezone: "Europe/Stockholm",
      departureTime: new Date("2026-10-07T16:45:00Z"),
      arrivalTime: new Date("2026-10-08T07:15:00Z"),
      status: "completed",
    },
  });
}

describe("sync feed: ferry crossings", () => {
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

  it("hands a crossing's create, edit and delete to an account that shows ferry", async () => {
    const user = await registerUser("sync-ferry-1", WITH_FERRY);
    const start = await drainFeed(user);

    const crossing = await createCrossing(user.id);
    await prisma.ferryJourney.update({ where: { id: crossing.id }, data: { seat: "Deck 7" } });
    const gone = await createCrossing(user.id, "Other");
    await prisma.ferryJourney.delete({ where: { id: gone.id } });

    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "ferry_journey").sort()).toEqual(
      [`upsert:${crossing.id}`, `delete:${gone.id}`].sort()
    );
    const record = delta.items.find((item) => item.id === crossing.id)?.record;
    expect(record?.seat).toBe("Deck 7");
    // Derived data and the roadtrip-link snapshot stay on the server.
    expect(record).not.toHaveProperty("geometry");
    expect(record).not.toHaveProperty("roadtripLegBefore");
  });

  it("keeps crossings, and their tombstones, from an account that hides ferry", async () => {
    const user = await registerUser("sync-ferry-2", ["flight"]);
    const start = await drainFeed(user);
    const crossing = await createCrossing(user.id);
    const gone = await createCrossing(user.id, "Other");
    await prisma.ferryJourney.delete({ where: { id: gone.id } });
    const delta = await drainFeed(user, start.cursor);
    expect(items(delta.items, "ferry_journey")).toEqual([]);
    expect(delta.items.map((item) => item.id)).not.toContain(crossing.id);
  });
});
