import { prisma } from "../../../../db";
import { setLocationProvider } from "../../../locationProvider/provider";
import { acceptStay, rejectStay } from "../../../dawarich/stays/review";
import { stayReviewSchema } from "../../../../schemas/dawarichStays";
import { markTravTrackDaysDirty } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { clearVisitRetry, projectVisitSuggestions, type VisitProjectionDeps } from "../project";
import type { VisitPick, VisitResolution } from "../resolve";
import {
  newOutletsForList,
  recentlyAutoAccepted,
  setListRule,
  suggestionsForPlace,
  undoAutoAccepted,
} from "../../../places/brandRules";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

const PREFIX = "smart-list-project-";
const DAY = "2026-11-10";
const NOW = new Date("2026-11-12T00:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T10:00:00Z`);
const SEOUL = { lat: 37.5665, lon: 126.978 };
const VENUE_AT = { lat: 37.5666, lon: 126.9781 };
const MCD = { brandWikidataId: "Q38076", brandName: "McDonald's" };
const SETTINGS = {
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: false,
};

const pick = (over: Partial<VisitPick> = {}): VisitPick => ({
  source: "osm",
  name: "McDonald's",
  ...VENUE_AT,
  placeId: null,
  osmRef: "way/1",
  type: "fast_food",
  category: "restaurant",
  isArea: true,
  resolved: "contains",
  distanceM: 14,
  alternatives: [],
  brand: { wikidata: "Q38076", name: "McDonald's", disused: false },
  ...over,
});
const picked = (over: Partial<VisitPick> = {}): VisitResolution => ({
  kind: "pick",
  lookedUp: true,
  pick: pick(over),
  lookup: { geocoder: "ok", venues: "ok" },
});

describe("smart lists in the visit projection", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let listId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  const deps = (): VisitProjectionDeps => ({
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
  });
  async function stand(minutes: number, at = SEOUL) {
    for (let i = 0; i <= minutes; i++) await storePoint(userId, { t: FROM + i * MIN, ...at });
  }
  const run = async () => {
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [DAY]));
    return projectVisitSuggestions(userId, deps());
  };
  const stays = () => prisma.dawarichStay.findMany({ where: { userId } });
  const accept = (row: { id: string; lat: number; lon: number }, name: string, placeId?: string) =>
    acceptStay(
      userId,
      row.id,
      stayReviewSchema.parse({
        placeId: placeId ?? null,
        tripId: null,
        name,
        lat: row.lat,
        lon: row.lon,
        startAt: { local: "2026-11-10T19:00" },
        endAt: { local: "2026-11-10T19:25" },
      })
    );

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
      data: { enabledDomains: ["poi"], staySuggestionsEnabled: true, data: {} },
    });
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.placeList.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    await prisma.travTrackStopDismissal.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    resolveStop.mockReset();
    resolveStop.mockResolvedValue(picked());
    clearVisitRetry();
    listId = (await prisma.placeList.create({ data: { userId, name: "Maccis" } })).id;
    await setListRule(userId, listId, [MCD], SETTINGS);
  });

  it("a stop inside the dwell window at the brand's venue carries the list match; a four-hour stop does not", async () => {
    await stand(25);
    await run();
    const [row] = await stays();
    expect(row.evidence).toMatchObject({
      visit: { brandMatches: [{ listId, listName: "Maccis", strength: "id", auto: false }] },
    });
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await stand(240);
    await run();
    const [long] = await stays();
    expect((long.evidence as { visit: object }).visit).not.toHaveProperty("brandMatches");
  });

  it("a brand-string-only match is flagged weaker and is never auto-accepted, whatever the list allows", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    resolveStop.mockResolvedValue(
      picked({ brand: { wikidata: null, name: "McDonald's", disused: false } })
    );
    await stand(25);
    const r = await run();
    const [row] = await stays();
    expect(row.status).toBe("pending");
    expect(r.autoAccepted).toBe(0);
    expect(row.evidence).toMatchObject({
      visit: { brandMatches: [{ strength: "name", auto: false }] },
    });
  });

  it("shows the same suggestion on the place page and in the new-outlet list, and one answer answers both", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "McDonald's Irschenberg", ...VENUE_AT, externalRef: "osm:way/1" },
    });
    resolveStop.mockResolvedValue(picked({ source: "known", placeId: place.id }));
    await stand(25);
    await run();
    const onPlace = await suggestionsForPlace(userId, place.id);
    const [inbox] = await stays();
    expect(onPlace).toHaveLength(1);
    expect(onPlace[0]).toMatchObject({
      id: inbox.id,
      durationMinutes: 25,
      distanceM: 14,
      lists: [{ listId, listName: "Maccis" }],
    });
    // Answering "not me" on the place answers the inbox entry too.
    await rejectStay(userId, onPlace[0].id);
    expect(await suggestionsForPlace(userId, place.id)).toHaveLength(0);
    expect((await stays())[0].status).toBe("rejected");
  });

  it("a new outlet is a suggested place inside the list; confirming creates the place, the visit and the entry as the owner's own", async () => {
    await stand(25);
    await run();
    const outlets = await newOutletsForList(userId, listId);
    expect(outlets).toHaveLength(1);
    expect(outlets[0].placeId).toBeNull();
    await accept({ id: outlets[0].id, ...VENUE_AT }, "McDonald's");
    const entry = await prisma.placeListEntry.findFirstOrThrow({ where: { listId } });
    expect(entry.createdBy).toBeNull();
    const place = await prisma.place.findFirstOrThrow({ where: { userId } });
    expect(place).toMatchObject({ brandWikidataId: "Q38076", createdBy: null });
    expect(await prisma.placeVisit.count({ where: { userId, createdBy: null } })).toBe(1);
    expect(await newOutletsForList(userId, listId)).toHaveLength(0);
  });

  it("auto-accept takes a confident match, marks it brandRule, and undo removes only what it made", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    await stand(25);
    const r = await run();
    expect(r.autoAccepted).toBe(1);
    const place = await prisma.place.findFirstOrThrow({ where: { userId } });
    expect(place.createdBy).toBe("brandRule");
    expect(await prisma.placeListEntry.count({ where: { listId, createdBy: "brandRule" } })).toBe(
      1
    );
    expect(await prisma.placeVisit.count({ where: { userId, createdBy: "brandRule" } })).toBe(1);
    const [fed] = await recentlyAutoAccepted(userId, listId);
    expect(fed.name).toBe("McDonald's");
    await undoAutoAccepted(userId, fed.id);
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    expect(await prisma.placeListEntry.count({ where: { listId } })).toBe(0);
    expect(await recentlyAutoAccepted(userId, listId)).toHaveLength(0);
    // The stop does not come back as a suggestion.
    expect((await stays())[0].status).toBe("rejected");
  });

  it("a venue 80 m away is suggested but not auto-accepted; one 60 m away is taken", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    resolveStop.mockResolvedValue(picked({ distanceM: 80 }));
    await stand(25);
    const far = await run();
    expect(far).toMatchObject({ created: 1, autoAccepted: 0 });
    expect((await stays())[0].status).toBe("pending");
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    resolveStop.mockResolvedValue(picked({ distanceM: 60 }));
    await stand(25);
    expect((await run()).autoAccepted).toBe(1);
  });

  it("undo spares a place, a list entry and a visit the owner already had", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    const place = await prisma.place.create({
      data: { userId, name: "McDonald's Irschenberg", ...VENUE_AT, externalRef: "osm:way/1" },
    });
    await prisma.placeListEntry.create({ data: { listId, placeId: place.id } });
    const manual = await prisma.placeVisit.create({
      data: {
        userId,
        placeId: place.id,
        visitedAt: new Date("2026-11-01T10:10:00Z"),
        visitedAtUtc: new Date("2026-11-01T10:10:00Z"),
        notes: "Frühstück",
      },
    });
    resolveStop.mockResolvedValue(picked({ source: "known", placeId: place.id }));
    await stand(25);
    const ran = await run();
    expect(ran.autoAccepted).toBe(1);
    const [fed] = await recentlyAutoAccepted(userId, listId);
    const undone = await undoAutoAccepted(userId, fed.id);
    expect(undone).toMatchObject({ removedPlace: false, removedEntries: 0 });
    expect(await prisma.place.count({ where: { id: place.id } })).toBe(1);
    expect(await prisma.placeListEntry.count({ where: { listId, placeId: place.id } })).toBe(1);
    expect(await prisma.placeVisit.findUnique({ where: { id: manual.id } })).not.toBeNull();
  });

  it("undo keeps an automatic visit that gained a photo, and a place that gained notes", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    await stand(25);
    expect((await run()).autoAccepted).toBe(1);
    const visit = await prisma.placeVisit.findFirstOrThrow({ where: { userId } });
    await prisma.placeVisitPhoto.create({
      data: { placeVisitId: visit.id, mimetype: "image/jpeg", sizeBytes: 1, provider: "local" },
    });
    await prisma.place.update({ where: { id: visit.placeId }, data: { notes: "Gute Pommes" } });
    const [fed] = await recentlyAutoAccepted(userId, listId);
    const undone = await undoAutoAccepted(userId, fed.id);
    expect(undone).toMatchObject({ removedVisit: false, keptVisit: "notes", removedPlace: false });
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: visit.id } })).toBe(1);
    expect(await prisma.place.count({ where: { id: visit.placeId } })).toBe(1);
  });

  it("undo on a wishlist place the owner had takes back the 'visited' its acceptance switched on", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    const place = await prisma.place.create({
      data: { userId, name: "McDonald's Wunsch", ...VENUE_AT, externalRef: "osm:way/1" },
    });
    expect(place.visited).toBe(false);
    resolveStop.mockResolvedValue(picked({ source: "known", placeId: place.id }));
    await stand(25);
    expect((await run()).autoAccepted).toBe(1);
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).visited).toBe(true);
    const [fed] = await recentlyAutoAccepted(userId, listId);
    const undone = await undoAutoAccepted(userId, fed.id);
    expect(undone).toMatchObject({ removedVisit: true, removedPlace: false });
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).visited).toBe(false);
  });

  it("drops a stop inside a privacy zone before any match: nothing is suggested or taken automatically", async () => {
    await setListRule(userId, listId, [MCD], { ...SETTINGS, autoAccept: true });
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", ...SEOUL, radiusM: 200 },
    });
    await stand(25);
    const r = await run();
    expect(r).toMatchObject({ created: 0, autoAccepted: 0, autoFailed: 0 });
    expect(await stays()).toHaveLength(0);
    expect(resolveStop).not.toHaveBeenCalled();
  });
});
