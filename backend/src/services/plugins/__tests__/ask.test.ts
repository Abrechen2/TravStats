import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { updatePolicy } from "../../externalServices/policy";
import {
  maxSuggestionDistanceM,
  askPlugin,
  askPlugins,
  clearPluginInFlight,
  CALLS_PER_HOUR,
  roundTo,
  stopPayload,
  type StopForPlugins,
} from "../ask";
import type { FetchLike } from "../../egress/boundedFetch";

/**
 * Asking the plugins (spec 2026-11-23, P3): rounding per precision, nothing that
 * identifies the account, asked once per stop, the limits, the backoff and the
 * 1 km rule.
 */
const PREFIX = "plugins-ask-";
let userId: string;
let username: string;
let pluginId: string;
const STOP: StopForPlugins = {
  fromMs: Date.UTC(2026, 10, 10, 9),
  untilMs: Date.UTC(2026, 10, 10, 10),
  lat: 48.123456,
  lon: 9.654321,
  zone: "Europe/Berlin",
  venue: { name: "Bürohaus" },
  address: { street: "Musterstraße 5", town: "Stuttgart", country: "DE" },
};
let bodies: string[] = [];
let reply: () => Response = () =>
  new Response(JSON.stringify({ version: 1, suggestions: [] }), { status: 200 });
const fetchImpl: FetchLike = async (_url, init) => {
  bodies.push(String(init.body));
  return reply();
};
const ask = (stop = STOP) => askPlugins(userId, stop, { fetch: fetchImpl });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  username = `${PREFIX}${Date.now()}`;
  const user = await prisma.user.create({
    data: { username, passwordHash: "synthetic-test-hash", firstName: "Erika" },
  });
  userId = user.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});
beforeEach(async () => {
  await prisma.suggestionPlugin.deleteMany({ where: { userId } });
  pluginId = (
    await prisma.suggestionPlugin.create({
      data: {
        userId,
        name: "Archiv",
        url: "https://plugin.example.com/hook",
        secretEncrypted: encryptApiKey("secret")!,
        precision: "100m",
      },
    })
  ).id;
  bodies = [];
  reply = () => new Response(JSON.stringify({ version: 1, suggestions: [] }), { status: 200 });
  clearPluginInFlight();
});

describe("rounding", () => {
  it.each([
    ["exact", 48.12346, 1],
    ["100m", 48.123, 100],
    ["1km", 48.12, 1000],
  ] as const)("%s rounds to %s and says %i m", (precision, lat, meters) => {
    expect(roundTo(48.123456, precision)).toBe(lat);
    expect(stopPayload(STOP, precision)).toMatchObject({ lat, precisionMeters: meters });
  });
  it.each(["exact", "100m"] as const)(
    "at %s sends what the account derived beside the point",
    (p) => {
      const full = { ...STOP, nearestPlace: { name: "Büro", distanceMeters: 37 } };
      expect(Object.keys(stopPayload(full, p)).sort()).toEqual([
        "address",
        "end",
        "lat",
        "lon",
        "nearestPlace",
        "precisionMeters",
        "start",
        "timeZone",
        "venue",
      ]);
    }
  );
  it("at 1 km sends only the rounded point: no venue, no place, no distance, no address", () => {
    const full = { ...STOP, nearestPlace: { name: "Büro", distanceMeters: 37 } };
    const sent = stopPayload(full, "1km");
    expect(Object.keys(sent).sort()).toEqual([
      "end",
      "lat",
      "lon",
      "precisionMeters",
      "start",
      "timeZone",
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/Büro|Bürohaus|Musterstraße|37/);
  });
});

describe("askPlugins", () => {
  it("sends the rounded stop and nothing that identifies the account", async () => {
    await ask();
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]);
    expect(body.stop).toMatchObject({ lat: 48.123, lon: 9.654, precisionMeters: 100 });
    for (const secret of [userId, username, "Erika", "48.123456"])
      expect(bodies[0]).not.toContain(secret);
    expect(Object.keys(body).sort()).toEqual(["kind", "locale", "requestId", "stop", "version"]);
  });

  it("asks once per stop: 'nothing here' is an answer too", async () => {
    await ask();
    expect(await ask()).toMatchObject({ outcomes: { known: 1 } });
    expect(bodies).toHaveLength(1);
  });

  it("asks again when the stop moved more than 300 m", async () => {
    await ask();
    await ask({ ...STOP, lat: STOP.lat + 0.02 });
    expect(bodies).toHaveLength(2);
  });

  it("holds a plugin at its hourly limit and leaves the stop owed for it", async () => {
    await prisma.suggestionPluginCall.createMany({
      data: Array.from({ length: CALLS_PER_HOUR }, () => ({ pluginId, userId, outcome: "empty" })),
    });
    expect(await ask()).toMatchObject({ owed: 1, owedIds: [pluginId], outcomes: { held: 1 } });
    expect(bodies).toHaveLength(0);
  });

  it("backs off after a failure, and honours Retry-After", async () => {
    reply = () => new Response("", { status: 429, headers: { "Retry-After": "7200" } });
    expect(await ask()).toMatchObject({ owed: 1, outcomes: { rateLimited: 1 } });
    const row = await prisma.suggestionPlugin.findUniqueOrThrow({ where: { id: pluginId } });
    expect(row.lastOutcome).toBe("rateLimited");
    expect(row.retryAt!.getTime()).toBeGreaterThan(Date.now() + 7_000_000);
    expect(
      await ask({ ...STOP, fromMs: STOP.fromMs + 7200_000, untilMs: STOP.untilMs + 7200_000 })
    ).toMatchObject({
      outcomes: { held: 1 },
    });
    expect(bodies).toHaveLength(1);
  });

  it("drops a suggestion more than 1 km from the stop", async () => {
    reply = () =>
      new Response(
        JSON.stringify({
          version: 1,
          suggestions: [
            { name: "Near", lat: 48.124, lon: 9.654, confidence: 0.9 },
            { name: "Far", lat: 48.2, lon: 9.654, confidence: 0.99 },
          ],
        }),
        { status: 200 }
      );
    const r = await ask();
    expect(r.answers.map((a) => a.suggestion.name)).toEqual(["Near"]);
    expect(r.outcomes).toMatchObject({ ok: 1, tooFar: 1 });
    const row = await prisma.suggestionPlugin.findUniqueOrThrow({ where: { id: pluginId } });
    expect(row).toMatchObject({ lastOutcome: "ok", lastVersion: 1, failures: 0 });
  });

  it("keeps a name match between 1 and 2 km when the plugin announced that radius", async () => {
    // ~1.5 km and ~2.5 km north of the stop.
    const at15 = { lat: 48.137, lon: 9.654321 };
    const at25 = { lat: 48.146, lon: 9.654321 };
    const answer = (nameRadiusMeters?: number) => () =>
      new Response(
        JSON.stringify({
          version: 1,
          ...(nameRadiusMeters !== undefined ? { nameRadiusMeters } : {}),
          suggestions: [
            { name: "MSA", ...at15, reason: "name", matchedToken: "MSA", confidence: 0.7 },
            { name: "Beyond", ...at25, reason: "name", confidence: 0.7 },
            { name: "DistanceFar", ...at15, reason: "distance", confidence: 0.9 },
          ],
        }),
        { status: 200 }
      );
    reply = answer(2500);
    const r = await ask();
    // Name match at 1.5 km kept; 2.5 km beyond the 2 km cap; a distance match stays at 1 km.
    expect(r.answers.map((a) => a.suggestion.name)).toEqual(["MSA"]);
    expect(r.outcomes).toMatchObject({ ok: 1, tooFar: 2 });

    // Without an announced radius the 1 km limit holds for name matches too.
    await prisma.suggestionPluginCall.deleteMany({ where: { pluginId } });
    clearPluginInFlight();
    reply = answer(undefined);
    const later = { ...STOP, fromMs: STOP.fromMs + 86_400_000, untilMs: STOP.untilMs + 86_400_000 };
    const plain = await ask(later);
    expect(plain.answers).toEqual([]);
  });

  it("caps the name-match radius at 2 km and never lowers the 1 km floor", () => {
    expect(maxSuggestionDistanceM({ reason: "name" }, 5000)).toBe(2000);
    expect(maxSuggestionDistanceM({ reason: "name" }, 300)).toBe(1000);
    expect(maxSuggestionDistanceM({ reason: "distance" }, 2000)).toBe(1000);
    expect(maxSuggestionDistanceM({}, 2000)).toBe(1000);
  });
});

describe("the kill switch", () => {
  it("is read before every call: off, nothing leaves", async () => {
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "suggestionPlugins"] }));
    try {
      const plugin = await prisma.suggestionPlugin.findUniqueOrThrow({ where: { id: pluginId } });
      expect(await askPlugin(plugin, STOP, "stop", { fetch: fetchImpl })).toBe("blocked");
      expect(bodies).toHaveLength(0);
    } finally {
      await updatePolicy((p) => ({
        ...p,
        disabled: p.disabled.filter((d) => d !== "suggestionPlugins"),
      }));
    }
  });
});
