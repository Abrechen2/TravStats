import { prisma } from "../../../../db";
import type { StayIdentityView } from "../../../dawarich/stays/identityCombine";
import { makeUser } from "../../__tests__/fixtures";
import { resolveVisit } from "../resolve";

const PREFIX = "travtrack-visit-resolve-";
const STOP = { lat: 37.5, lon: 127, fromMs: 1_000_000, untilMs: 2_800_000 };
const SWITCHES = { staySuggestionsImmichEvidence: false };

const view = (over: Partial<StayIdentityView> = {}): StayIdentityView => ({
  probable: { name: "McDonald's", source: "nearbyPlace", photoSupported: false },
  address: null,
  geocoder: "ok",
  candidates: [
    {
      name: "McDonald's",
      type: "fast_food",
      address: null,
      city: null,
      lat: 37.5001,
      lon: 127.0001,
      distanceM: 14,
      photoCount: null,
      osmRef: "way/1",
      isArea: true,
    },
    {
      name: "McCafé",
      type: "cafe",
      address: null,
      city: null,
      lat: 37.50005,
      lon: 127.00005,
      distanceM: 7,
      photoCount: null,
      osmRef: "node/2",
      foldedInto: "McDonald's",
    },
  ],
  candidatesState: "ok",
  venues: { state: "ok", resolved: "contains" },
  photos: { state: "off", count: 0, cities: [], truncated: false },
  ...over,
});

describe("resolveVisit", () => {
  let userId: string;
  const identity = jest.fn();

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  });
  beforeEach(async () => {
    identity.mockReset();
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  const run = (allowLookup = true) =>
    resolveVisit(userId, STOP, SWITCHES, { allowLookup }, { identity });

  it("names the building, not the McCafé counter inside it, and keeps the counter as the alternative", async () => {
    identity.mockResolvedValue(view());
    const r = await run();
    expect(r.kind).toBe("pick");
    if (r.kind !== "pick") return;
    expect(r.pick).toMatchObject({
      source: "osm",
      name: "McDonald's",
      osmRef: "way/1",
      category: "restaurant",
      isArea: true,
      resolved: "contains",
      placeId: null,
    });
    expect(r.pick.alternatives[0]).toMatchObject({ name: "McCafé", foldedInto: "McDonald's" });
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it("an own place within its radius is a visit of that place, and asks nobody", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "My Mickey D", lat: 37.50003, lon: 127.00003 },
    });
    const r = await run();
    expect(r).toMatchObject({ kind: "pick", pick: { source: "known", placeId: place.id } });
    expect(identity).not.toHaveBeenCalled();
  });

  it("a venue that is already an own place by its OSM id is that place, not a duplicate to create", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Golden Arches", lat: 37.51, lon: 127.01, externalRef: "osm:way/1" },
    });
    identity.mockResolvedValue(view());
    const r = await run();
    expect(r).toMatchObject({
      kind: "pick",
      pick: { source: "known", placeId: place.id, name: "Golden Arches" },
    });
  });

  it("a lodging beside the stop is no venue to suggest", async () => {
    await prisma.lodging.create({
      data: { userId, name: "Hotel", lat: 37.5, lon: 127, type: "hotel" },
    });
    expect(await run()).toEqual({ kind: "none", why: "lodging" });
    expect(identity).not.toHaveBeenCalled();
  });

  it("defers a stop that needs a lookup once the run's lookups are spent", async () => {
    expect(await run(false)).toEqual({ kind: "deferred" });
    expect(identity).not.toHaveBeenCalled();
  });

  it("a failed place search is a failure with its reason, never 'no venue'", async () => {
    identity.mockResolvedValue(
      view({ candidatesState: "degraded", candidates: [], probable: null })
    );
    expect(await run()).toEqual({ kind: "failed", reason: "places" });
  });

  it.each(["timeout", "rateLimited", "budget", "unavailable"] as const)(
    "an Overpass outage (%s) defers the stop instead of falling back to the nearest counter",
    async (state) => {
      identity.mockResolvedValue(view({ venues: { state, resolved: null } }));
      expect(await run()).toEqual({ kind: "failed", reason: "venues" });
    }
  );

  it("an address alone is not a venue", async () => {
    identity.mockResolvedValue(
      view({
        probable: { name: "Main St 1", source: "address", photoSupported: false },
        candidates: [],
      })
    );
    expect(await run()).toEqual({ kind: "none", why: "noVenue" });
  });

  it("open data switched off still answers, and says so in the evidence", async () => {
    identity.mockResolvedValue(view({ venues: { state: "off", resolved: null } }));
    const r = await run();
    expect(r).toMatchObject({ kind: "pick", lookup: { venues: "off" } });
  });
});
