import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import type { PlaceResult } from "../../geo/photon";
import { fillLocalNames } from "../localNameFill";
import type { PlaceNameGeocoder } from "../placeNameBackfill";

/**
 * The 12 places of 2026-10-04/05 (prod): Latin names from the Companion in
 * Korea, no name on the sign. Photon is a fake — under test is which rows are
 * asked about, what is matched, and what is written or left alone.
 */
const USER = "localnamefill";
const TOWER = { lat: 37.5513, lon: 126.9883 };

const hit = (over: Partial<PlaceResult> & { name: string }): PlaceResult => ({ ...TOWER, ...over });

function fake(english: PlaceResult[] | null, local: PlaceResult[] | null): PlaceNameGeocoder {
  return {
    searchEnglish: async () => null,
    reverseEnglish: async () => english,
    reverseDefault: async () => local,
  };
}

describe("local-name fill", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (
      await prisma.user.create({
        data: { username: USER, passwordHash: await hashPassword("password123") },
      })
    ).id;
  });
  beforeEach(() => prisma.place.deleteMany({ where: { userId } }));
  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  let seq = 0;
  const place = (name: string, over: Record<string, unknown> = {}) =>
    prisma.place.create({
      data: {
        userId,
        name,
        category: "landmark",
        ...TOWER,
        isoCountryCode: "KR",
        externalRef: `companion:place-${(seq += 1)}@37.5513,126.9883`,
        ...over,
      },
    });
  const reload = (id: string) => prisma.place.findUniqueOrThrow({ where: { id } });
  const run = (geo: PlaceNameGeocoder, apply = true) =>
    fillLocalNames({ geocoder: geo, apply, userId });

  it("adds the name on the sign to a Latin-named place, matched by the map, and adopts the OSM ref", async () => {
    const p = await place("Namsan Seoul Tower");
    const report = await run(
      fake(
        [hit({ name: "Namsan Seoul Tower", externalRef: "osm:way/1" })],
        [hit({ name: "남산서울타워", externalRef: "osm:way/1" })]
      )
    );
    expect(report.fills).toMatchObject([{ placeId: p.id, localName: "남산서울타워" }]);
    expect(await reload(p.id)).toMatchObject({
      name: "Namsan Seoul Tower",
      localName: "남산서울타워",
      externalRef: "osm:way/1",
    });
  });

  it("leaves a place alone when no object near the pin carries its name", async () => {
    const p = await place("Peace Park");
    const report = await run(
      fake(
        [hit({ name: "Imjingak", externalRef: "osm:way/2" })],
        [hit({ name: "임진각", externalRef: "osm:way/2" })]
      )
    );
    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_match" }]);
    expect((await reload(p.id)).localName).toBeNull();
  });

  it("leaves a place alone when the matched object has no other-script name", async () => {
    const p = await place("CU");
    const report = await run(
      fake(
        [hit({ name: "CU", externalRef: "osm:node/3" })],
        [hit({ name: "CU", externalRef: "osm:node/3" })]
      )
    );
    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_local_name" }]);
  });

  it("does not take the name of an object farther than the match radius", async () => {
    const p = await place("Namsan Seoul Tower");
    const far = { lat: TOWER.lat + 0.01, lon: TOWER.lon };
    const report = await run(
      fake(
        [hit({ name: "Namsan Seoul Tower", externalRef: "osm:way/1", ...far })],
        [hit({ name: "남산서울타워", externalRef: "osm:way/1", ...far })]
      )
    );
    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_match" }]);
  });

  it("asks only about places in a country that writes another script", async () => {
    await place("Eiffel Tower", { isoCountryCode: "FR" });
    await place("서울역", { isoCountryCode: "KR" }); // not Latin — the name backfill's case
    const report = await run(fake([], []));
    expect(report.scanned).toBe(0);
  });

  it("writes nothing on a dry run, and a failed lookup costs nothing", async () => {
    const p = await place("Namsan Seoul Tower");
    const dry = await run(
      fake(
        [hit({ name: "Namsan Seoul Tower", externalRef: "osm:way/1" })],
        [hit({ name: "남산서울타워", externalRef: "osm:way/1" })]
      ),
      false
    );
    expect(dry.fills).toHaveLength(1);
    expect((await reload(p.id)).localName).toBeNull();
    const failed = await run(fake(null, null));
    expect(failed.abstentions).toMatchObject([{ placeId: p.id, reason: "lookup_failed" }]);
  });

  it("matches a name the map writes longer, when exactly one nearby object contains it", async () => {
    const p = await place("Jongmyo");
    const report = await run(
      fake(
        [
          hit({ name: "Jongmyo Shrine", externalRef: "osm:way/4" }),
          hit({ name: "Jongno 3-ga Station", externalRef: "osm:node/5" }),
        ],
        [hit({ name: "종묘", externalRef: "osm:way/4" })]
      )
    );
    expect(report.fills).toMatchObject([{ placeId: p.id, localName: "종묘" }]);
  });

  // Prod dry run, 2026-10-06: both would have taken another object's name.
  it.each([
    ["Fuji", "JP", "Mount Fuji Weather Station", "富士山測候所"],
    ["Wat Pho", "TH", "Wat Pho directoty", "แผนผังวัดโพธิ์"],
  ])(
    "does not take the name of an object that merely mentions %s",
    async (name, isoCountryCode, longer, local) => {
      const p = await place(name, { isoCountryCode });
      const report = await run(
        fake(
          [hit({ name: longer, externalRef: "osm:way/8" })],
          [hit({ name: local, externalRef: "osm:way/8" })]
        )
      );
      expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_match" }]);
      expect((await reload(p.id)).localName).toBeNull();
    }
  );

  it("accepts a longer map name that adds only what kind of place it is", async () => {
    const p = await place("Fuji", { isoCountryCode: "JP" });
    const report = await run(
      fake(
        [hit({ name: "Mount Fuji", externalRef: "osm:node/9" })],
        [hit({ name: "富士山", externalRef: "osm:node/9" })]
      )
    );
    expect(report.fills).toMatchObject([{ placeId: p.id, localName: "富士山" }]);
  });

  it("does not guess between two nearby objects that both contain the name", async () => {
    const p = await place("Peace Park");
    const report = await run(
      fake(
        [
          hit({ name: "Peace Park Square", externalRef: "osm:way/6" }),
          hit({ name: "Peace Park Station", externalRef: "osm:way/7" }),
        ],
        [hit({ name: "평화누리공원", externalRef: "osm:way/6" })]
      )
    );
    expect(report.abstentions).toMatchObject([{ placeId: p.id, reason: "no_match" }]);
  });
});
