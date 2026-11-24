import { prisma } from "../../../../db";
import { setLocationProvider } from "../../../locationProvider/provider";
import { stayReviewSchema } from "../../../../schemas/dawarichStays";
import { acceptStay } from "../../../dawarich/stays/review";
import { encryptApiKey } from "../../../../utils/encryption";
import { clearPluginInFlight } from "../../../plugins/ask";
import { deletePlugin } from "../../../plugins/registry";
import { markTravTrackDaysDirty } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { clearVisitRetry, projectVisitSuggestions, type VisitProjectionDeps } from "../project";
import type { VisitResolution } from "../resolve";
import type { FetchLike } from "../../../egress/boundedFetch";
import { placeOfEnrichment } from "../enrich";
import { runBackfill } from "../../../plugins/backfill";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

/**
 * Plugin answers in the stay inbox (spec 2026-11-23-plugins-and-calendar.md, P3):
 * merged into the stop's finding with the plugin named, a no-venue stop made a
 * finding, a failed plugin asked again for the open finding, and accepting the
 * plugin's suggestion links the place by its reference.
 */
const PREFIX = "travtrack-visit-plugins-";
const DAY = "2026-11-10";
const NOW = new Date("2026-11-12T00:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T10:00:00Z`);
const AT = { lat: 37.5665, lon: 126.978 };
const noVenue: VisitResolution = { kind: "none", why: "noVenue" };
const venue: VisitResolution = {
  kind: "pick",
  lookedUp: true,
  lookup: { geocoder: "ok", venues: "ok" },
  pick: {
    source: "osm",
    name: "Bürohaus",
    lat: AT.lat + 0.0001,
    lon: AT.lon,
    placeId: null,
    osmRef: "way/9",
    type: "office",
    category: "other",
    isArea: true,
    resolved: "contains",
    distanceM: 12,
    brand: null,
    alternatives: [],
  },
};
const suggestion = {
  name: "Projekt 4711",
  lat: AT.lat + 0.0003,
  lon: AT.lon,
  purpose: "business",
  externalRef: "4711",
  url: "https://archive.example.com/p/4711",
  confidence: 0.95,
};

describe("projectVisitSuggestions with a plugin", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let pluginId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  let reply: () => Response;
  const fetchImpl: FetchLike = async () => reply();
  const deps: VisitProjectionDeps = {
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
    plugins: { fetch: fetchImpl },
  };
  const rows = () =>
    prisma.dawarichStay.findMany({ where: { userId }, orderBy: { startAt: "asc" } });
  const answer = () =>
    new Response(JSON.stringify({ version: 1, suggestions: [suggestion] }), { status: 200 });
  const review = (row: { lat: number; lon: number; name: string | null }) =>
    stayReviewSchema.parse({
      placeId: null,
      tripId: null,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      startAt: { local: "2026-11-10T19:00" },
      endAt: { local: "2026-11-10T19:25" },
      pluginRef: { pluginId, externalRef: "4711" },
    });

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
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.suggestionPlugin.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    pluginId = (
      await prisma.suggestionPlugin.create({
        data: {
          userId,
          name: "Projektarchiv",
          url: "https://plugin.example.com/hook",
          secretEncrypted: encryptApiKey("secret")!,
        },
      })
    ).id;
    reply = answer;
    resolveStop.mockReset();
    clearVisitRetry();
    clearPluginInFlight();
    for (let i = 0; i <= 40; i++) await storePoint(userId, { t: FROM + i * MIN, ...AT });
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [DAY]));
  });

  it("merges the plugin's answer into the venue finding, naming the plugin", async () => {
    resolveStop.mockResolvedValue(venue);
    const r = await projectVisitSuggestions(userId, deps);
    expect(r).toMatchObject({ created: 1, plugins: { ok: 1 } });
    const [row] = await rows();
    expect(row.name).toBe("Bürohaus");
    expect(row.evidence).toMatchObject({
      suggestedPurpose: "business",
      suggestedPurposeFrom: `plugin:${pluginId}`,
      plugins: [{ pluginId, pluginName: "Projektarchiv", name: "Projekt 4711", confidence: 0.95 }],
    });
  });

  it("makes a no-venue stop a finding from the plugin's best located suggestion", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    expect(row).toMatchObject({ name: "Projekt 4711", lat: suggestion.lat });
    expect(row.evidence).toMatchObject({ createdFrom: `plugin:${pluginId}` });
  });

  it("a failed plugin leaves the finding waiting for it and the next run asks again", async () => {
    resolveStop.mockResolvedValue(venue);
    reply = () => new Response("", { status: 503 });
    const r = await projectVisitSuggestions(userId, deps);
    expect(r).toMatchObject({ created: 1, plugins: { server: 1 } });
    expect((await rows())[0].evidence).toMatchObject({ pluginsPending: [pluginId] });
    // The backoff passes, the plugin answers: the catch-up merges it without re-reading the day.
    await prisma.suggestionPlugin.update({ where: { id: pluginId }, data: { retryAt: null } });
    reply = answer;
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, ["2026-11-11"]));
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    expect(row.evidence).not.toHaveProperty("pluginsPending");
    expect(row.evidence).toMatchObject({ plugins: [{ name: "Projekt 4711" }] });
  });

  it("accepting the plugin's suggestion links the place by plugin:<id>:<ref>, and a second visit finds it", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    await acceptStay(userId, row.id, review(row));
    const place = await prisma.place.findFirstOrThrow({ where: { userId } });
    expect(place.externalRef).toBe(`plugin:${pluginId}:4711`);
    const visit = await prisma.placeVisit.findFirstOrThrow({ where: { userId } });
    expect(visit.purpose).toBe("business");
    const again = await placeOfEnrichment(userId, {
      calendar: null,
      calendarFailed: false,
      pluginsPending: [],
      plugins: [
        { pluginId, pluginName: "Projektarchiv", suggestion: suggestion as never, distanceM: 30 },
      ],
    });
    expect(again?.placeId).toBe(place.id);
  });

  it("a reference the finding does not carry links nothing", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    await acceptStay(userId, row.id, {
      ...review(row),
      pluginRef: { pluginId, externalRef: "made-up" },
    });
    expect((await prisma.place.findFirstOrThrow({ where: { userId } })).externalRef).toBeNull();
  });

  describe("backfill", () => {
    beforeEach(() =>
      prisma.suggestionPlugin.update({ where: { id: pluginId }, data: { backfillAllowed: true } })
    );

    it("asks about the past days' stops and suggests, never accepts", async () => {
      const r = await runBackfill(userId, pluginId, DAY, DAY, undefined, { fetch: fetchImpl });
      expect(r).toMatchObject({ days: 1, asked: 1, created: 1, stoppedAt: null });
      const [row] = await rows();
      expect(row).toMatchObject({ status: "pending", name: "Projekt 4711" });
      expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
      // Run again: the stop is answered, nothing is asked twice.
      const again = await runBackfill(userId, pluginId, DAY, DAY, undefined, { fetch: fetchImpl });
      expect(again).toMatchObject({ asked: 0, known: 1 });
    });

    it("waits for the limits and stops, saying where, when they hold too long", async () => {
      await prisma.suggestionPlugin.update({
        where: { id: pluginId },
        data: { retryAt: new Date(Date.now() + 3_600_000) },
      });
      const sleep = jest.fn(async () => {});
      const r = await runBackfill(userId, pluginId, DAY, DAY, undefined, {
        fetch: fetchImpl,
        sleep,
        maxWaitMs: 180_000,
      });
      expect(sleep).toHaveBeenCalledTimes(3);
      expect(r.stoppedAt).not.toBeNull();
      expect(await rows()).toHaveLength(0);
    });
  });

  it("removing the plugin removes the finding it alone made", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    expect(await rows()).toHaveLength(1);
    await deletePlugin(userId, pluginId);
    expect(await rows()).toHaveLength(0);
  });
});
