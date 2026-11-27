import { prisma } from "../../../../db";
import { setLocationProvider } from "../../../locationProvider/provider";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { projectVisitSuggestions } from "../project";
import { applyOwnerName } from "../../stopPlaces/ownerName";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

/**
 * Smart lists for plain stay findings (prod 26.11.2026): three McDonald's stays stayed pending
 * with auto-accept on, because only visit findings were ever matched. And the owner's own name
 * for a stop wins over every guess: a brand rule never claims it ("Aldi Süd").
 */
const PREFIX = "travtrack-dwell-brands-";
const NOW = new Date("2026-11-26T12:00:00Z");
const FROM = Date.parse("2026-11-24T08:14:00Z");
const MIN = 60_000;
const MCD = { lat: 47.7484, lon: 11.5655 };
const BRAND = "Q38076";

describe("brand rules on plain stay findings", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let placeId: string;
  let listId: string;

  const dwell = async () => {
    // The stay's own points: accepting re-checks that the evidence still holds.
    for (let i = 0; i <= 21; i++) await storePoint(userId, { t: FROM + i * MIN, ...MCD });
    return prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: `dwell-${FROM}`,
        sourceStartAt: new Date(FROM),
        sourceEndAt: new Date(FROM + 21 * MIN),
        sourceLat: MCD.lat + 0.0001,
        sourceLon: MCD.lon,
        startAt: new Date(FROM),
        endAt: new Date(FROM + 21 * MIN),
        lat: MCD.lat,
        lon: MCD.lon,
        zone: "Europe/Berlin",
        pointCount: 19,
        evidence: { source: "travtrack", explanation: { code: "stay.dwell", params: {} } },
        placeId,
        name: "McDonald's Bad Tölz",
        provider: "travtrack",
      },
    });
  };

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    userId = await makeUser(`${PREFIX}a`);
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["poi"], locationProvider: "travtrack" },
    });
    await prisma.dawarichStayScan.create({ data: { userId, enabled: true } });
  });
  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  });
  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["poi"], staySuggestionsEnabled: true },
    });
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.placeList.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.travTrackStopPlace.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    placeId = (
      await prisma.place.create({
        data: { userId, name: "McDonald's Bad Tölz", ...MCD, brandWikidataId: BRAND },
      })
    ).id;
    listId = (await prisma.placeList.create({ data: { userId, name: "McDonald's" } })).id;
    await prisma.placeListBrandRule.create({
      data: {
        listId,
        userId,
        brandWikidataId: BRAND,
        brandName: "McDonald's",
        autoAccept: true,
      },
    });
  });

  it("takes a matching stay finding with auto-accept on, marked as the rule's, and lists the place", async () => {
    const row = await dwell();
    const r = await projectVisitSuggestions(userId, { now: NOW });
    expect(r.autoAccepted).toBe(1);
    const done = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("accepted");
    expect(done.evidence).toMatchObject({ brandMatches: [{ listId, auto: true }] });
    expect(await prisma.placeListEntry.count({ where: { listId, placeId } })).toBe(1);
  });

  it("leaves it pending with auto-accept off", async () => {
    await prisma.placeListBrandRule.updateMany({ where: { userId }, data: { autoAccept: false } });
    const row = await dwell();
    await projectVisitSuggestions(userId, { now: NOW });
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending"
    );
  });

  it("never claims a stop the owner named himself, and the owner's name replaces the guess", async () => {
    const row = await dwell();
    const span = { fromMs: FROM - MIN, untilMs: FROM + 22 * MIN };
    await prisma.travTrackStopPlace.create({
      data: {
        userId,
        fromMs: BigInt(span.fromMs),
        untilMs: BigInt(span.untilMs),
        name: "Aldi Süd",
      },
    });
    await applyOwnerName(userId, span, "Aldi Süd");
    await projectVisitSuggestions(userId, { now: NOW });
    const kept = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    expect(kept).toMatchObject({ status: "pending", name: "Aldi Süd", placeId: null });
    expect(kept.evidence).toMatchObject({ ownerNamed: true });
    expect(kept.evidence).not.toHaveProperty("brandMatches");
  });
});
