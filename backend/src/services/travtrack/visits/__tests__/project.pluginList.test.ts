import request from "supertest";
import app from "../../../../index";
import { prisma } from "../../../../db";
import { generateToken } from "../../../../utils/jwt";
import { setLocationProvider } from "../../../locationProvider/provider";
import { stayReviewSchema } from "../../../../schemas/dawarichStays";
import { acceptStay } from "../../../dawarich/stays/review";
import { encryptApiKey } from "../../../../utils/encryption";
import { clearPluginInFlight } from "../../../plugins/ask";
import { deletePlugin } from "../../../plugins/registry";
import {
  pluginHelloSchema,
  pluginSuggestionSchema,
  type PluginHello,
} from "../../../plugins/contract";
import { setPluginListEnabled, syncPluginList } from "../../../places/pluginLists";
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
 * Plugin-fed place lists (owner 2026-11-26): generic for any plugin. A hello announcing `list`
 * makes one list per registration; accepted suggestions put their place in it with the announced
 * columns filled from `externalRef.fields`; nothing else joins.
 */
const PREFIX = "travtrack-plugin-list-";
const DAY = "2026-11-10";
const NOW = new Date("2026-11-12T00:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T10:00:00Z`);
const AT = { lat: 37.5665, lon: 126.978 };
const noVenue: VisitResolution = { kind: "none", why: "noVenue" };
const suggestion = {
  name: "Kunde A",
  lat: AT.lat + 0.0003,
  lon: AT.lon,
  externalRef: {
    id: "4711",
    label: "Neubau Halle 3",
    fields: { colA: "4711", colB: "Neubau Halle 3", notAnnounced: "dropped" },
  },
  confidence: 0.95,
};
const HELLO: PluginHello = pluginHelloSchema.parse({
  name: "Fake",
  version: 1,
  kinds: ["stop"],
  list: {
    defaultName: { de: "Fake-Liste", en: "Fake list" },
    columns: [
      { key: "colA", label: { de: "Nr.", en: "No." } },
      { key: "colB", label: { de: "Name", en: "Name" } },
    ],
  },
});

describe("plugin-fed place lists", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let pluginId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify({ version: 1, suggestions: [suggestion] }), { status: 200 });
  const deps: VisitProjectionDeps = {
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
    plugins: { fetch: fetchImpl },
  };
  const plugin = () => prisma.suggestionPlugin.findUniqueOrThrow({ where: { id: pluginId } });
  const acceptTheSuggestion = async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await prisma.dawarichStay.findMany({ where: { userId } });
    await acceptStay(
      userId,
      row.id,
      stayReviewSchema.parse({
        placeId: null,
        tripId: null,
        name: row.name,
        lat: row.lat,
        lon: row.lon,
        startAt: { local: "2026-11-10T19:00" },
        endAt: { local: "2026-11-10T19:25" },
        pluginRef: { pluginId, externalRef: "4711" },
      })
    );
    return prisma.place.findFirstOrThrow({ where: { userId, externalRef: { not: null } } });
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
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.placeList.deleteMany({ where: { userId } });
    await prisma.suggestionPlugin.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    pluginId = (
      await prisma.suggestionPlugin.create({
        data: {
          userId,
          name: "Registrierung X",
          url: "https://plugin.example.com/hook",
          secretEncrypted: encryptApiKey("secret")!,
        },
      })
    ).id;
    resolveStop.mockReset();
    clearVisitRetry();
    clearPluginInFlight();
    for (let i = 0; i <= 40; i++) await storePoint(userId, { t: FROM + i * MIN, ...AT });
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [DAY]));
  });

  it("a plugin announcing a list gets one with the announced name and columns", async () => {
    const state = await syncPluginList(userId, await plugin(), HELLO, "de");
    expect(state).toMatchObject({ enabled: true, announced: true, listName: "Fake-Liste" });
    const list = await prisma.placeList.findUniqueOrThrow({ where: { id: state.listId! } });
    expect(list.pluginId).toBe(pluginId);
    expect(list.pluginColumns).toEqual(HELLO.list!.columns);
    // Asking again keeps the one list.
    await syncPluginList(userId, await plugin(), HELLO, "en");
    expect(await prisma.placeList.count({ where: { userId } })).toBe(1);
  });

  it("an accepted suggestion becomes a member with only the announced columns; an unrelated place does not", async () => {
    const { listId } = await syncPluginList(userId, await plugin(), HELLO, "de");
    const place = await acceptTheSuggestion();
    const other = await prisma.place.create({
      data: { userId, name: "Bäcker", lat: AT.lat, lon: AT.lon, category: "other" },
    });
    const entries = await prisma.placeListEntry.findMany({ where: { listId: listId! } });
    expect(entries.map((e) => e.placeId)).toEqual([place.id]);
    expect(entries.map((e) => e.placeId)).not.toContain(other.id);
    expect(entries[0].createdBy).toBe("plugin");
    expect(entries[0].externalFields).toEqual({
      id: "4711",
      label: "Neubau Halle 3",
      fields: { colA: "4711", colB: "Neubau Halle 3" },
    });

    const res = await request(app)
      .get(`/api/v1/place-lists/${listId}/members`)
      .set("Cookie", `auth_token=${generateToken(userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.columns.map((c: { key: string }) => c.key)).toEqual(["colA", "colB"]);
    expect(res.body.data.rows[0]).toMatchObject({
      placeId: place.id,
      source: "plugin",
      visitCount: 1,
      external: { fields: { colA: "4711" } },
    });
  });

  it("a list made after the fact is filled with the places of earlier accepted suggestions", async () => {
    const place = await acceptTheSuggestion();
    const { listId } = await syncPluginList(userId, await plugin(), HELLO, "de");
    const [entry] = await prisma.placeListEntry.findMany({ where: { listId: listId! } });
    expect(entry.placeId).toBe(place.id);
    expect(entry.externalFields).toMatchObject({ fields: { colA: "4711" } });
  });

  it("a plugin without `list` gets no list until switched on, then generic columns only", async () => {
    const bare = pluginHelloSchema.parse({ name: "Bare", version: 1, kinds: ["stop"] });
    expect(await syncPluginList(userId, await plugin(), bare, "de")).toMatchObject({
      enabled: false,
      listId: null,
    });
    expect(await prisma.placeList.count({ where: { userId } })).toBe(0);
    const on = await setPluginListEnabled(userId, await plugin(), true, bare, "de");
    expect(on).toMatchObject({ enabled: true, listName: "Registrierung X" });
    const list = await prisma.placeList.findUniqueOrThrow({ where: { id: on.listId! } });
    expect(list.pluginColumns).toEqual([]);
  });

  it("places carrying the plugin's announced reference namespace join, also made outside the accept flow", async () => {
    const mk = (name: string, externalRef: string | null) =>
      prisma.place.create({
        data: { userId, name, lat: AT.lat, lon: AT.lon, category: "other", externalRef },
      });
    const own = await mk("Kunde 4711", "proj:4711");
    const viaAlias = await mk("Kunde 99", null);
    await prisma.placeExternalRef.create({
      data: { userId, placeId: viaAlias.id, ref: "proj:99" },
    });
    const foreign = await mk("Osm-Ort", "osm:node/1");
    const lookalike = await mk("Projektor", "projx:1");
    const hello = pluginHelloSchema.parse({
      ...HELLO,
      list: { ...HELLO.list, refNamespace: "proj" },
    });
    const { listId } = await syncPluginList(userId, await plugin(), hello, "de");
    const entries = await prisma.placeListEntry.findMany({ where: { listId: listId! } });
    const byPlace = new Map(entries.map((e) => [e.placeId, e]));
    expect([...byPlace.keys()].sort()).toEqual([own.id, viaAlias.id].sort());
    expect(byPlace.get(own.id)!.externalFields).toMatchObject({ id: "4711" });
    expect(byPlace.get(viaAlias.id)!.externalFields).toMatchObject({ id: "99" });
    expect(byPlace.has(foreign.id) || byPlace.has(lookalike.id)).toBe(false);

    // A place made later joins on the next look at the settings card, once.
    const later = await mk("Kunde 5000", "proj:5000");
    await syncPluginList(userId, await plugin(), hello, "de");
    await syncPluginList(userId, await plugin(), hello, "de");
    const after = await prisma.placeListEntry.findMany({ where: { listId: listId! } });
    expect(after.map((e) => e.placeId)).toContain(later.id);
    expect(after).toHaveLength(3);

    // A plugin cannot claim a prefix TravStats writes itself.
    expect(
      pluginHelloSchema.safeParse({ ...HELLO, list: { ...HELLO.list, refNamespace: "plugin" } })
        .success
    ).toBe(false);
  });

  it("switching off or removing the plugin keeps the list as a normal list", async () => {
    const { listId } = await syncPluginList(userId, await plugin(), HELLO, "de");
    await setPluginListEnabled(userId, await plugin(), false, HELLO, "de");
    expect(
      (await prisma.placeList.findUniqueOrThrow({ where: { id: listId! } })).pluginId
    ).toBeNull();
    // Off is remembered: the announcing hello no longer makes a new one.
    expect(await syncPluginList(userId, await plugin(), HELLO, "de")).toMatchObject({
      enabled: false,
      listId: null,
    });
    await setPluginListEnabled(userId, await plugin(), true, HELLO, "de");
    await deletePlugin(userId, pluginId);
    const lists = await prisma.placeList.findMany({ where: { userId } });
    expect(lists).toHaveLength(2);
    expect(lists.every((l) => l.pluginId === null)).toBe(true);
  });
});

describe("plugin contract: list and externalRef", () => {
  const base = { name: "X", confidence: 0.5 };
  it("takes the plain string and the object form", () => {
    expect(pluginSuggestionSchema.safeParse({ ...base, externalRef: "4711" }).success).toBe(true);
    expect(
      pluginSuggestionSchema.safeParse({ ...base, externalRef: { id: "4711", fields: { a: "1" } } })
        .success
    ).toBe(true);
  });
  it("rejects bad keys, long values, too many fields and an empty id", () => {
    const bad = [
      { id: "1", fields: { "bad key": "1" } },
      { id: "1", fields: { a: "x".repeat(201) } },
      { id: "1", fields: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [`k${i}`, "v"])) },
      { id: "" },
      { id: "x".repeat(201) },
    ];
    for (const externalRef of bad)
      expect(pluginSuggestionSchema.safeParse({ ...base, externalRef }).success).toBe(false);
  });
  it("rejects duplicate or invalid column keys and a missing language", () => {
    const hello = (list: unknown) =>
      pluginHelloSchema.safeParse({ name: "X", version: 1, kinds: [], list }).success;
    const label = { de: "A", en: "A" };
    expect(hello({ defaultName: label, columns: [{ key: "a", label }] })).toBe(true);
    expect(
      hello({
        defaultName: label,
        columns: [
          { key: "a", label },
          { key: "a", label },
        ],
      })
    ).toBe(false);
    expect(hello({ defaultName: label, columns: [{ key: "1a", label }] })).toBe(false);
    expect(hello({ defaultName: { de: "A" }, columns: [] })).toBe(false);
  });
});
