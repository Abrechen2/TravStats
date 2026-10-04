import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import type { PlaceResult } from "../../geo/photon";
import { backfillPlaceNames, sameName, type PlaceNameGeocoder } from "../placeNameBackfill";

/**
 * forgejo#199: stored places brought into the two-name format. Photon is a
 * fake here — what is under test is which rows are asked about, what is
 * matched, and what is written (or, on abstention, not written).
 */
const USERS = ["placenamebackfill", "placenamebackfill2"];
// The places measured on prod, near Seoul City Hall.
const CITY_HALL = { lat: 37.5663, lon: 126.9779 };
const CHICKEN = "교촌치킨 서울시청점";
const MUSEUM = "한국은행 화폐박물관";

const hit = (over: Partial<PlaceResult> & { name: string }): PlaceResult => ({
  ...CITY_HALL,
  ...over,
});

interface FakeAnswers {
  search?: PlaceResult[] | null;
  reverseDefault?: PlaceResult[] | null;
  reverseEnglish?: PlaceResult[] | null;
}

function fakePhoton(answers: FakeAnswers): PlaceNameGeocoder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchEnglish: async (q) => {
      calls.push(`search:${q}`);
      return answers.search ?? null;
    },
    reverseDefault: async () => {
      calls.push("reverse:default");
      return answers.reverseDefault ?? null;
    },
    reverseEnglish: async () => {
      calls.push("reverse:en");
      return answers.reverseEnglish ?? null;
    },
  };
}

describe("place name backfill", () => {
  let userId: string;
  let otherUserId: string;

  const cleanup = async () => {
    await prisma.place.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const [u, o] = await Promise.all(
      USERS.map(async (username) =>
        prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } })
      )
    );
    userId = u.id;
    otherUserId = o.id;
  });

  beforeEach(async () => {
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /** A Companion "Ort jetzt" place: its ref is a placeholder minted from the pin. */
  let seq = 0;
  const place = (name: string, over: Record<string, unknown> = {}) =>
    prisma.place.create({
      data: {
        userId,
        name,
        category: "food",
        ...CITY_HALL,
        externalRef: `companion:@${CITY_HALL.lat},${CITY_HALL.lon}#${(seq += 1)}`,
        ...over,
      },
    });
  const reload = (id: string) => prisma.place.findUniqueOrThrow({ where: { id } });
  const run = (geocoder: PlaceNameGeocoder, apply = true) =>
    backfillPlaceNames({ geocoder, apply, userId });

  it("splits a glued name without asking the network", async () => {
    const p = await place("Banpo Bridge Moonlight Rainbow Fountain 반포대교 달빛무지개분수");
    const photon = fakePhoton({});

    const report = await run(photon);

    expect(photon.calls).toEqual([]);
    expect(report.changes).toMatchObject([{ placeId: p.id, kind: "split" }]);
    expect(await reload(p.id)).toMatchObject({
      name: "Banpo Bridge Moonlight Rainbow Fountain",
      localName: "반포대교 달빛무지개분수",
    });
  });

  it("finds the Latin name by coordinates and adopts the OSM ref for a placeholder", async () => {
    const p = await place(CHICKEN);
    const photon = fakePhoton({
      reverseDefault: [
        hit({ name: "서울특별시청", externalRef: "osm:way/1" }),
        hit({ name: `${CHICKEN} `, externalRef: "osm:node/42", lat: 37.5665 }),
      ],
      reverseEnglish: [
        hit({ name: "Seoul City Hall", externalRef: "osm:way/1" }),
        hit({ name: "Kyochon Chicken Seoul City Hall", externalRef: "osm:node/42" }),
      ],
    });

    const report = await run(photon);

    expect(photon.calls).toEqual(["reverse:default", "reverse:en"]);
    expect(report.changes).toMatchObject([{ kind: "latin" }]);
    expect(await reload(p.id)).toMatchObject({
      name: "Kyochon Chicken Seoul City Hall",
      localName: CHICKEN,
      externalRef: "osm:node/42",
    });
  });

  it("does not match a same-named object farther than 150 m away", async () => {
    const p = await place(CHICKEN);
    const photon = fakePhoton({
      // ~330 m north.
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42", lat: 37.5693 })],
      reverseEnglish: [hit({ name: "Kyochon Chicken", externalRef: "osm:node/42", lat: 37.5693 })],
    });

    const report = await run(photon);

    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_match" }]);
    expect(await reload(p.id)).toMatchObject({ name: CHICKEN, localName: null });
  });

  it("asks Photon for the object itself when the place carries an OSM ref", async () => {
    const p = await place(MUSEUM, { externalRef: "osm:way/77" });
    const photon = fakePhoton({
      search: [
        hit({ name: "Bank of Korea", externalRef: "osm:way/76" }),
        hit({ name: "Bank of Korea Money Museum", externalRef: "osm:way/77" }),
      ],
    });

    await run(photon);

    expect(photon.calls).toEqual([`search:${MUSEUM}`]);
    expect(await reload(p.id)).toMatchObject({
      name: "Bank of Korea Money Museum",
      localName: MUSEUM,
      externalRef: "osm:way/77",
    });
  });

  it("abstains — and reports — when no Latin name exists or the lookup fails", async () => {
    const noLatin = await place(CHICKEN);
    const failed = await place(MUSEUM, { lat: 37.56, externalRef: "osm:way/77" });
    const photon = fakePhoton({
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      reverseEnglish: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      search: null,
    });

    const report = await run(photon);

    expect(report.changes).toEqual([]);
    expect(report.abstentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ placeId: noLatin.id, reason: "no_latin_name" }),
        expect.objectContaining({ placeId: failed.id, reason: "lookup_failed" }),
      ])
    );
    expect(await reload(noLatin.id)).toMatchObject({ name: CHICKEN, localName: null });
    expect(await reload(failed.id)).toMatchObject({ name: MUSEUM, localName: null });
  });

  it("never throws when the geocoder does", async () => {
    const p = await place(CHICKEN);
    const photon: PlaceNameGeocoder = {
      searchEnglish: async () => {
        throw new Error("boom");
      },
      reverseDefault: async () => {
        throw new Error("boom");
      },
      reverseEnglish: async () => {
        throw new Error("boom");
      },
    };
    const report = await run(photon);
    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "lookup_failed" }]);
  });

  it("keeps the placeholder ref when another place of the user already holds the OSM ref", async () => {
    await place("Kyochon Chicken", { externalRef: "osm:node/42", lat: 37.5664 });
    const p = await place(CHICKEN);
    const photon = fakePhoton({
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      reverseEnglish: [hit({ name: "Kyochon Chicken", externalRef: "osm:node/42" })],
    });

    const report = await run(photon);

    expect(report.changes).toMatchObject([{ placeId: p.id, refCollision: true }]);
    expect(await reload(p.id)).toMatchObject({
      name: "Kyochon Chicken",
      localName: CHICKEN,
      externalRef: expect.stringMatching(/^companion:@/),
    });
  });

  it("adopts the ref when only ANOTHER user holds it", async () => {
    await prisma.place.create({
      data: { userId: otherUserId, name: "Kyochon", ...CITY_HALL, externalRef: "osm:node/42" },
    });
    const p = await place(CHICKEN);
    const photon = fakePhoton({
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      reverseEnglish: [hit({ name: "Kyochon Chicken", externalRef: "osm:node/42" })],
    });
    await run(photon);
    expect((await reload(p.id)).externalRef).toBe("osm:node/42");
  });

  it("writes nothing on a dry run, and reports the same changes", async () => {
    const glued = await place("Seoul Station 서울역");
    const p = await place(CHICKEN);
    const photon = fakePhoton({
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      reverseEnglish: [hit({ name: "Kyochon Chicken", externalRef: "osm:node/42" })],
    });

    const report = await run(photon, false);

    expect(report.changes.map((c) => c.kind).sort()).toEqual(["latin", "split"]);
    expect(await reload(glued.id)).toMatchObject({ name: "Seoul Station 서울역", localName: null });
    expect(await reload(p.id)).toMatchObject({ name: CHICKEN, localName: null });
  });

  it("is idempotent: a second run changes nothing and asks nothing for repaired rows", async () => {
    await place("Seoul Station 서울역");
    await place(CHICKEN);
    const photon = fakePhoton({
      reverseDefault: [hit({ name: CHICKEN, externalRef: "osm:node/42" })],
      reverseEnglish: [hit({ name: "Kyochon Chicken", externalRef: "osm:node/42" })],
    });
    await run(photon);
    const before = await prisma.place.findMany({ where: { userId }, orderBy: { id: "asc" } });

    const second = fakePhoton({});
    const report = await run(second);

    expect(report).toMatchObject({ scanned: 0, changes: [], abstentions: [] });
    expect(second.calls).toEqual([]);
    expect(await prisma.place.findMany({ where: { userId }, orderBy: { id: "asc" } })).toEqual(
      before
    );
  });

  it("leaves Latin names and places that already have a local name alone", async () => {
    await place("Brandenburger Tor");
    await place("서울역", { localName: "서울역사" });
    const photon = fakePhoton({});
    const report = await run(photon);
    expect(report.scanned).toBe(0);
    expect(photon.calls).toEqual([]);
  });

  it("stops looking up at the cap and reports the rest", async () => {
    await place(CHICKEN);
    await place(MUSEUM, { lat: 37.56 });
    const photon = fakePhoton({ reverseDefault: [] });
    const report = await backfillPlaceNames({
      geocoder: photon,
      apply: true,
      userId,
      lookupCap: 1,
    });
    expect(report.lookups).toBe(1);
    expect(report.abstentions.map((a) => a.reason).sort()).toEqual(["cap_reached", "no_match"]);
  });

  it("compares names by NFC, case and whitespace", () => {
    expect(sameName("Café  Central", "café central")).toBe(true);
    expect(sameName("반포대교", "반포대교 ")).toBe(true);
    expect(sameName("반포대교", "반포")).toBe(false);
  });
});
