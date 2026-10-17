import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { reverseGeocodeDetailed } from "../../services/geo/nominatim";
import { reversePlacesDetailed } from "../../services/geo/photon";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { createImmichClient, type ImmichClient } from "../../services/immich/immichClient";
import { ImmichError, type ImmichAsset } from "../../services/immich/types";
import { llmRefusalFor } from "../../services/llm/llmGate";
import { llmGenerateChain, type LlmTarget } from "../../services/llm/llmProvider";
import { clearStayIdentityCache } from "../../services/dawarich/stays/identity";
import { clearStayPlaceTypeCache } from "../../services/dawarich/stays/placeType";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual("../../services/geo/nominatim"),
  reverseGeocodeDetailed: jest.fn(),
}));
jest.mock("../../services/geo/photon", () => ({
  ...jest.requireActual("../../services/geo/photon"),
  reversePlacesDetailed: jest.fn(),
}));
jest.mock("../../services/immich/immichResolver", () => ({
  ...jest.requireActual("../../services/immich/immichResolver"),
  getImmichConnection: jest.fn(),
}));
jest.mock("../../services/immich/immichClient", () => ({
  ...jest.requireActual("../../services/immich/immichClient"),
  createImmichClient: jest.fn(),
}));
jest.mock("../../services/llm/llmGate", () => ({
  ...jest.requireActual("../../services/llm/llmGate"),
  llmRefusalFor: jest.fn(),
}));
jest.mock("../../services/llm/llmProvider", () => ({
  ...jest.requireActual("../../services/llm/llmProvider"),
  llmGenerateChain: jest.fn(),
}));

/**
 * GET /dawarich-stays/:id/identity and /place-type (forgejo#305): what the
 * stay card shows, from Dawarich alone, Immich alone and both — and every way
 * a source can fail arriving as itself, never as an empty success.
 */

const geocode = jest.mocked(reverseGeocodeDetailed);
const places = jest.mocked(reversePlacesDetailed);
const connection = jest.mocked(getImmichConnection);
const client = jest.mocked(createImmichClient);
const refusal = jest.mocked(llmRefusalFor);
const generate = jest.mocked(llmGenerateChain);

const point = { lat: 38.7105, lon: -9.1424 };
const window = {
  sourceStartAt: new Date("2026-10-10T14:50:00Z"),
  sourceEndAt: new Date("2026-10-10T16:20:00Z"),
};
const cafe = { name: "A Brasileira", lat: 38.7107, lon: -9.1424, type: "cafe", city: "Lisboa" };
const photo = (id: string, lat: number, city?: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-10-10T15:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat,
  lon: point.lon,
  ...(city ? { city } : {}),
});
const ollama: LlmTarget = { kind: "ollama", url: "http://localhost:11434", model: "m" };

let userId: string;
let otherId: string;
let cookie: string;
let stayId: string;
let otherStayId: string;
let searchAssetsByDate: jest.Mock;

const settings = (data: Record<string, boolean>) =>
  prisma.userSettings.update({ where: { userId }, data });
const identity = (id = stayId) =>
  request(app).get(`/api/v1/dawarich-stays/${id}/identity`).set("Cookie", cookie);
const placeType = () =>
  request(app).get(`/api/v1/dawarich-stays/${stayId}/place-type`).set("Cookie", cookie);

async function stayFor(owner: string, fingerprint: string): Promise<string> {
  const row = await prisma.dawarichStay.create({
    data: {
      userId: owner,
      fingerprint,
      ...window,
      sourceLat: point.lat,
      sourceLon: point.lon,
      startAt: window.sourceStartAt,
      endAt: window.sourceEndAt,
      ...point,
      zone: "Europe/Lisbon",
      pointCount: 4,
      evidence: { source: "dawarich", zone: "Europe/Lisbon", pointIds: [1], uncertainties: [] },
    },
  });
  return row.id;
}

beforeAll(async () => {
  const stamp = Date.now();
  userId = (
    await prisma.user.create({
      data: { username: `stay-identity-${stamp}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: { username: `stay-identity-other-${stamp}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
  await prisma.userSettings.create({ data: { userId, enabledDomains: ["poi"], data: {} } });
  stayId = await stayFor(userId, "identity-own");
  otherStayId = await stayFor(otherId, "identity-other");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.clearAllMocks();
  clearStayIdentityCache();
  clearStayPlaceTypeCache();
  await settings({
    staySuggestionsEnabled: true,
    staySuggestionsImmichEvidence: true,
    staySuggestionsLlmPlaceClassification: false,
  });
  geocode.mockResolvedValue({
    parts: { address: "Rua Garrett 120", city: "Lisboa", country: "Portugal" },
    degraded: false,
  });
  places.mockResolvedValue({ results: [cafe], degraded: false });
  connection.mockResolvedValue({ baseUrl: "http://immich.test", apiKey: "k", source: "user" });
  searchAssetsByDate = jest.fn(async () => ({
    assets: [photo("near", 38.7107, "Lisboa"), photo("far", 38.75, "Lisboa")],
    truncated: false,
  }));
  client.mockReturnValue({ searchAssetsByDate } as unknown as ImmichClient);
  refusal.mockResolvedValue(null);
  generate.mockResolvedValue({ text: '{"type":"cafe"}', target: ollama });
});

describe("GET /dawarich-stays/:id/identity", () => {
  it("combines the stay's own position, the geocoders and the stay's photos", async () => {
    const res = await identity();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ...point,
      probable: { name: "A Brasileira", source: "nearbyPlace", photoSupported: true },
      address: { address: "Rua Garrett 120", city: "Lisboa", country: "Portugal" },
      geocoder: "ok",
      candidatesState: "ok",
      // The photo 4 km away is outside the stay — only the near one counts.
      photos: { state: "ok", count: 1, cities: [{ name: "Lisboa", count: 1 }] },
      placeTypeAvailable: false,
    });
    // The window searched is the stay's own, read from the row.
    expect(searchAssetsByDate).toHaveBeenCalledWith({
      takenAfter: window.sourceStartAt,
      takenBefore: window.sourceEndAt,
    });
    expect(places).toHaveBeenCalledWith(point.lat, point.lon, { limit: 5, radiusKm: 0.25 });
  });

  it("works on Dawarich alone without an Immich connection", async () => {
    connection.mockResolvedValue(null);
    const res = await identity();
    expect(res.body.data.photos.state).toBe("notConfigured");
    expect(res.body.data.probable).toEqual({
      name: "A Brasileira",
      source: "nearbyPlace",
      photoSupported: false,
    });
  });

  it("does not ask Immich when the account switched the photo evidence off", async () => {
    await settings({ staySuggestionsImmichEvidence: false });
    const res = await identity();
    expect(res.body.data.photos.state).toBe("off");
    expect(connection).not.toHaveBeenCalled();
    expect(searchAssetsByDate).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", new ImmichError("unreachable", "down", 503)],
    ["auth", new ImmichError("auth", "bad key", 401)],
  ])("reports Immich %s as itself and still names the place", async (kind, error) => {
    searchAssetsByDate.mockRejectedValue(error);
    const res = await identity();
    expect(res.status).toBe(200);
    expect(res.body.data.photos).toEqual({ state: kind, count: 0, cities: [], truncated: false });
    expect(res.body.data.probable.name).toBe("A Brasileira");
  });

  it("names the photos' city on Immich alone when the geocoders are rate-limited", async () => {
    geocode.mockResolvedValue({ parts: null, degraded: true });
    places.mockResolvedValue({ results: [], degraded: true });
    const res = await identity();
    expect(res.body.data).toMatchObject({
      geocoder: "degraded",
      candidatesState: "degraded",
      probable: { name: "Lisboa", source: "photos" },
    });
  });

  it("caches a complete answer, but asks again after a failed lookup", async () => {
    await identity();
    await identity();
    expect(geocode).toHaveBeenCalledTimes(1);

    clearStayIdentityCache();
    geocode.mockResolvedValue({ parts: null, degraded: true });
    await identity();
    await identity();
    expect(geocode).toHaveBeenCalledTimes(3);
  });

  it("answers 404 for another account's finding, without asking anyone", async () => {
    const res = await identity(otherStayId);
    expect(res.status).toBe(404);
    expect(geocode).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });

  it("is refused while stay suggestions are switched off — no geocoder request", async () => {
    await settings({ staySuggestionsEnabled: false });
    const res = await identity();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STAY_SUGGESTIONS_DISABLED");
    expect(geocode).not.toHaveBeenCalled();
    expect(places).not.toHaveBeenCalled();
  });

  it("offers the place type only when the account switched it on", async () => {
    await settings({ staySuggestionsLlmPlaceClassification: true });
    expect((await identity()).body.data.placeTypeAvailable).toBe(true);
  });
});

describe("GET /dawarich-stays/:id/place-type", () => {
  it("is off by default and asks no model", async () => {
    const res = await placeType();
    expect(res.body.data).toEqual({ state: "off" });
    expect(refusal).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  describe("switched on", () => {
    beforeEach(() => settings({ staySuggestionsLlmPlaceClassification: true }));

    it("classifies from the candidate names only — no coordinates leave", async () => {
      const res = await placeType();
      expect(res.body.data).toEqual({
        state: "ok",
        type: "cafe",
        provider: { kind: "ollama", isCloud: false, host: null },
      });
      const prompt = generate.mock.calls[0][0];
      expect(prompt.prompt).toContain("A Brasileira");
      expect(`${prompt.system}${prompt.prompt}`).not.toMatch(/38\.71|9\.142|Rua Garrett/);
      // Ollama first, like every parser: the chain decides, with defaults.
      expect(generate.mock.calls[0][1]).toEqual({ withDefaults: true });
    });

    it("says which gate refused, and sends nothing", async () => {
      refusal.mockResolvedValue({ kind: "cloud_not_consented", reason: "x" });
      const res = await placeType();
      expect(res.body.data).toEqual({ state: "refused", refusal: "cloud_not_consented" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("reports a model timeout as a timeout", async () => {
      generate.mockRejectedValue(new Error("Stay place-type request timeout after 20000ms"));
      expect((await placeType()).body.data).toEqual({ state: "failed", failure: "timeout" });
    });

    it("reports an unreachable model as unavailable, and retries next time", async () => {
      generate.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
      expect((await placeType()).body.data).toEqual({ state: "failed", failure: "unavailable" });
      expect((await placeType()).body.data.state).toBe("ok");
    });

    it("rejects an answer outside the vocabulary instead of showing it", async () => {
      generate.mockResolvedValue({ text: '{"type":"spaceport"}', target: ollama });
      expect((await placeType()).body.data).toEqual({ state: "failed", failure: "unusable" });
    });

    it("asks nothing when there is no nearby place to classify", async () => {
      places.mockResolvedValue({ results: [], degraded: false });
      expect((await placeType()).body.data).toEqual({ state: "noCandidates" });
      expect(generate).not.toHaveBeenCalled();
    });
  });
});
