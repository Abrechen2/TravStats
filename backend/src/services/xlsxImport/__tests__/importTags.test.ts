import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Tags in the spreadsheet for lodging, places, roadtrips and tours
 * (forgejo#405 item 13 follow-up). The export writes them as one
 * comma-separated cell; before this, a round trip silently dropped them.
 */
describe("spreadsheet import — tags (lodging, places, roadtrips, tours)", () => {
  const USER = "xlsxtags";
  let userId: string;

  const run = (key: string, rows: Record<string, string>[]) =>
    importSheets([{ key, rows }], { userId, dryRun: false, mode: "merge" });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("creates a place with its tags and updates them from a later file", async () => {
    const [created] = await run("places", [
      { name: "Tagged Place", lat: "5", lon: "5", tags: "Strand, Sonnenuntergang" },
    ]);
    expect(created.created).toBe(1);
    const place = await prisma.place.findFirstOrThrow({ where: { userId, name: "Tagged Place" } });
    expect(place.tags).toEqual(["Strand", "Sonnenuntergang"]);
    await run("places", [{ id: place.id, name: "Tagged Place", tags: "Strand" }]);
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).tags).toEqual([
      "Strand",
    ]);
  });

  it("creates a lodging with its tags and updates them from a later file", async () => {
    await run("lodging", [{ name: "Tagged Haus", city: "Bergen", tags: "Frühstück, Meerblick" }]);
    const l = await prisma.lodging.findFirstOrThrow({ where: { userId, name: "Tagged Haus" } });
    expect(l.tags).toEqual(["Frühstück", "Meerblick"]);
    await run("lodging", [{ id: l.id, name: "Tagged Haus", tags: "Meerblick" }]);
    expect((await prisma.lodging.findUniqueOrThrow({ where: { id: l.id } })).tags).toEqual([
      "Meerblick",
    ]);
  });

  it("creates a roadtrip with its tags and updates them from a later file", async () => {
    await run("roadtrips", [{ name: "Tagged Roadtrip", tags: "Familie, Sommer" }]);
    const r = await prisma.tripRoute.findFirstOrThrow({
      where: { userId, name: "Tagged Roadtrip" },
    });
    expect(r.tags).toEqual(["Familie", "Sommer"]);
    await run("roadtrips", [{ id: r.id, name: "Tagged Roadtrip", tags: "Familie" }]);
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: r.id } })).tags).toEqual([
      "Familie",
    ]);
  });

  it("creates a tour with its tags and updates them from a later file", async () => {
    await run("tours", [{ name: "Tagged Tour", activity: "hike", tags: "Grat, Gipfel" }]);
    const r = await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Tagged Tour" } });
    expect(r.tags).toEqual(["Grat", "Gipfel"]);
    await run("tours", [{ id: r.id, name: "Tagged Tour", tags: "Gipfel" }]);
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: r.id } })).tags).toEqual([
      "Gipfel",
    ]);
  });
});
