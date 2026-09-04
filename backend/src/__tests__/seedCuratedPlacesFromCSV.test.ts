import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { seedCuratedPlacesFromCSV } from "../seedCuratedPlacesFromCSV";

const USER = "curatedseedtest";
const COLOSSEUM = "world-wonders-new7:colosseum";
const PETRA = "world-wonders-new7:petra";

describe("seedCuratedPlacesFromCSV", () => {
  const wipe = async (): Promise<void> => {
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.curatedPlace.deleteMany({});
    await prisma.curatedList.deleteMany({});
  };

  beforeEach(wipe);

  afterAll(async () => {
    // Leave the dev DB holding the real catalog, like the ship/port suites.
    await wipe();
    await seedCuratedPlacesFromCSV();
    await prisma.$disconnect();
  });

  it("seeds the shipped lists and their targets", async () => {
    const written = await seedCuratedPlacesFromCSV();

    const lists = await prisma.curatedList.count();
    const places = await prisma.curatedPlace.count();
    expect(lists).toBeGreaterThanOrEqual(2);
    expect(places).toBeGreaterThanOrEqual(14);
    expect(written).toBe(lists + places);
  });

  // forgejo#66 — the biosphere-reserve and national-park lists shipped with
  // no test naming them; a CSV dropped from the SOURCE_FILES array would
  // have gone unnoticed.
  it("seeds the biosphere-reserve and national-park lists, each with places", async () => {
    await seedCuratedPlacesFromCSV();

    for (const key of ["biosphere-reserves", "nationalparks-de", "nationalparks-us"]) {
      const list = await prisma.curatedList.findUnique({ where: { key } });
      const places = await prisma.curatedPlace.count({ where: { listKey: key } });
      expect({ key, listed: list !== null, hasPlaces: places > 0 }).toEqual({ key, listed: true, hasPlaces: true });
    }
  });

  it("writes nothing on a second run", async () => {
    await seedCuratedPlacesFromCSV();
    expect(await seedCuratedPlacesFromCSV()).toBe(0);
  });

  it("carries a corrected coordinate to an existing row — unlike the port and ship seeds", async () => {
    await seedCuratedPlacesFromCSV();
    await prisma.curatedPlace.update({
      where: { id: COLOSSEUM },
      data: { lat: 0, lon: 0, blurb: "veraltet" },
    });

    // Exactly one row differs from the CSV, so exactly one write happens.
    expect(await seedCuratedPlacesFromCSV()).toBe(1);

    const row = await prisma.curatedPlace.findUnique({ where: { id: COLOSSEUM } });
    expect(row?.lat).toBeCloseTo(41.8902, 4);
    expect(row?.lon).toBeCloseTo(12.4922, 4);
    expect(row?.blurb).not.toBe("veraltet");
  });

  it("never touches a place the user already ticked", async () => {
    const user = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    await seedCuratedPlacesFromCSV();

    // Ticking copies the target into the user's own row. From that moment the
    // row is theirs — corrected name, corrected position, their notes.
    const place = await prisma.place.create({
      data: {
        userId: user.id,
        curatedItemId: COLOSSEUM,
        name: "Kolosseum — Südtor",
        category: "landmark",
        lat: 41.89,
        lon: 12.49,
        visited: true,
        dataSource: "curated",
      },
    });

    await prisma.curatedPlace.update({
      where: { id: COLOSSEUM },
      data: { name: "Anders", lat: 0, lon: 0 },
    });
    await seedCuratedPlacesFromCSV();

    const reloaded = await prisma.place.findUnique({ where: { id: place.id } });
    expect(reloaded?.name).toBe("Kolosseum — Südtor");
    expect(reloaded?.lat).toBeCloseTo(41.89, 4);
    expect(reloaded?.visited).toBe(true);
  });

  it("keeps a catalog row that left the CSV instead of deleting it", async () => {
    await seedCuratedPlacesFromCSV();
    await prisma.curatedList.create({ data: { key: "retired-list", name: "Zurückgezogen" } });
    await prisma.curatedPlace.create({
      data: { id: "retired-list:somewhere", listKey: "retired-list", name: "Irgendwo", lat: 1, lon: 1 },
    });

    await seedCuratedPlacesFromCSV();

    // Deleting would strand every place a user ticked from it: `curatedItemId`
    // is a plain column, so nothing cascades and nothing warns them.
    expect(await prisma.curatedList.findUnique({ where: { key: "retired-list" } })).not.toBeNull();
    expect(
      await prisma.curatedPlace.findUnique({ where: { id: "retired-list:somewhere" } })
    ).not.toBeNull();
  });

  it("mirrors English beside the German copy, and omits it where the name is the same", async () => {
    await seedCuratedPlacesFromCSV();

    const colosseum = await prisma.curatedPlace.findUnique({ where: { id: COLOSSEUM } });
    expect(colosseum?.name).toBe("Kolosseum");
    expect(colosseum?.nameEn).toBe("Colosseum");
    expect(colosseum?.blurbEn).toBeTruthy();

    // "Petra" is Petra in both languages; a duplicate would be noise the client
    // has to compare instead of a null it can fall back through.
    const petra = await prisma.curatedPlace.findUnique({ where: { id: PETRA } });
    expect(petra?.name).toBe("Petra");
    expect(petra?.nameEn).toBeNull();
  });

  it("gives every target a position that can actually be drawn", async () => {
    await seedCuratedPlacesFromCSV();

    for (const place of await prisma.curatedPlace.findMany()) {
      expect(Math.abs(place.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(place.lon)).toBeLessThanOrEqual(180);
      // Null Island is what an unparsed coordinate looks like.
      expect(place.lat === 0 && place.lon === 0).toBe(false);
      expect(place.isoCountryCode).toMatch(/^[A-Z]{2}$/);
    }
  });
});
