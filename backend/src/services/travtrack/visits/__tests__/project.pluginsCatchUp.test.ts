import { prisma } from "../../../../db";
import { setLocationProvider } from "../../../locationProvider/provider";
import { encryptApiKey } from "../../../../utils/encryption";
import { clearPluginInFlight } from "../../../plugins/ask";
import { markTravTrackDaysDirty } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { clearVisitRetry, projectVisitSuggestions, type VisitProjectionDeps } from "../project";
import type { VisitResolution } from "../resolve";
import type { FetchLike } from "../../../egress/boundedFetch";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

/**
 * The plugins are asked about every stop by themselves (prod, 24.-26.11.2026: no
 * call after the first day). Three gaps closed: a stop whose finding the stay
 * scan made first was never asked (only this projection's own findings were),
 * the catch-up ran only behind an owed day, and a missed stop had no way back
 * but the manual backfill.
 */
const PREFIX = "travtrack-visit-plugins-catchup-";
const DAY = "2026-11-24";
const NOW = new Date("2026-11-26T12:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T14:47:00Z`);
const AT = { lat: 47.5123, lon: 10.271 };
const noVenue: VisitResolution = { kind: "none", why: "noVenue" };
const suggestion = {
  name: "MSA Zentralküche Sonthofen",
  lat: AT.lat + 0.0003,
  lon: AT.lon,
  confidence: 0.9,
};

describe("plugins asked automatically", () => {
  const switches = travTrackSwitches();
  let userId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  const sent: Record<string, unknown>[] = [];
  let reply: () => object = () => ({ version: 1, suggestions: [suggestion] });
  const fetchImpl: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(reply()), { status: 200 });
  };
  const deps: VisitProjectionDeps = {
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
    plugins: { fetch: fetchImpl },
  };
  const rows = () =>
    prisma.dawarichStay.findMany({ where: { userId }, orderBy: { startAt: "asc" } });

  /** A plain stay-scan finding over the stop: no `evidence.visit`, no name. */
  const dwellFinding = (fromMs = FROM, untilMs = FROM + 40 * MIN) =>
    prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: `dwell-${fromMs}`,
        sourceStartAt: new Date(fromMs),
        sourceEndAt: new Date(untilMs),
        sourceLat: AT.lat,
        sourceLon: AT.lon,
        startAt: new Date(fromMs),
        endAt: new Date(untilMs),
        lat: AT.lat,
        lon: AT.lon,
        zone: "Europe/Berlin",
        pointCount: 18,
        evidence: { source: "travtrack", explanation: { code: "stay.dwell", params: {} } },
        provider: "travtrack",
      },
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
    await prisma.suggestionPlugin.deleteMany({ where: { userId } });
    await prisma.travTrackStopPlace.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.suggestionPlugin.create({
      data: {
        userId,
        name: "Projektarchiv",
        url: "https://plugin.example.com/hook",
        secretEncrypted: encryptApiKey("secret")!,
      },
    });
    sent.length = 0;
    reply = () => ({ version: 1, suggestions: [suggestion] });
    resolveStop.mockReset();
    resolveStop.mockResolvedValue(noVenue);
    clearVisitRetry();
    clearPluginInFlight();
  });

  const storeStop = async () => {
    for (let i = 0; i <= 40; i++) await storePoint(userId, { t: FROM + i * MIN, ...AT });
  };
  const markDirty = () => prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [DAY]));

  it("a new stop is asked exactly once, however often its day is read again", async () => {
    await storeStop();
    await markDirty();
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
    await markDirty();
    await projectVisitSuggestions(userId, deps);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
  });

  it("asks about a stop whose finding the stay scan made first, and merges the answer", async () => {
    await storeStop();
    const finding = await dwellFinding();
    await markDirty();
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
    const [row] = await rows();
    expect(row.id).toBe(finding.id);
    expect(row.evidence).toMatchObject({
      plugins: [{ name: "MSA Zentralküche Sonthofen", pluginName: "Projektarchiv" }],
    });
  });

  it("catches up a missed stop with no day owed, once, and sends the name the owner gave it", async () => {
    // The day was acknowledged long ago (a starved run, a deploy): nothing is dirty.
    const finding = await dwellFinding();
    await prisma.travTrackStopPlace.create({
      data: {
        userId,
        fromMs: BigInt(FROM - MIN),
        untilMs: BigInt(FROM + 41 * MIN),
        name: "MSA - Menü Service Allgäu",
      },
    });
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ stop: { venue: { name: "MSA - Menü Service Allgäu" } } });
    const row = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: finding.id } });
    expect(row.evidence).toMatchObject({ plugins: [{ name: "MSA Zentralküche Sonthofen" }] });
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
  });

  it("the catch-up stays bounded: older missed stops wait for the next run", async () => {
    for (let i = 0; i < 12; i++)
      await dwellFinding(FROM - i * 3_600_000, FROM - i * 3_600_000 + 30 * MIN);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(10);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(12);
  });

  it("a finding older than the look-back is left to the backfill", async () => {
    await dwellFinding(NOW.getTime() - 20 * 86_400_000, NOW.getTime() - 20 * 86_400_000 + 30 * MIN);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(0);
  });

  it("re-asks the stops a plugin answered empty once it announces a change (a name-match release)", async () => {
    reply = () => ({ version: 1, suggestions: [] });
    const older = await dwellFinding(FROM - 3 * 3_600_000, FROM - 3 * 3_600_000 + 30 * MIN);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
    const asked = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: older.id } });
    // The inbox offers "Neu fragen" on an empty answer too.
    expect(asked.evidence).toMatchObject({ pluginsAsked: [expect.any(String)] });
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(1);
    // The plugin's next answer announces a name radius: its empty answers are forgotten.
    reply = () => ({ version: 1, suggestions: [], nameRadiusMeters: 2000 });
    await dwellFinding();
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(2);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(3);
    await projectVisitSuggestions(userId, deps);
    expect(sent).toHaveLength(3);
  });
});
