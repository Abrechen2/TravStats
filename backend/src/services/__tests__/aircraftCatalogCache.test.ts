import { prisma } from "../../db";
import {
  getAircraftCatalog,
  invalidateAircraftCatalogCache,
  getAircraftCatalogSync,
  preloadAircraftCatalog,
} from "../aircraftCatalogCache";

describe("aircraftCatalogCache", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads aircraft from the DB and caches them", async () => {
    const first = await getAircraftCatalog();
    expect(first.length).toBeGreaterThan(200);
    expect(first.find((a) => a.icao === "AT43")?.name).toBe("ATR 42-300");
  });

  it("exposes a sync snapshot after preload", async () => {
    invalidateAircraftCatalogCache();
    expect(getAircraftCatalogSync()).toEqual([]);
    await preloadAircraftCatalog();
    expect(getAircraftCatalogSync().length).toBeGreaterThan(200);
  });

  it("reloads after invalidation", async () => {
    await preloadAircraftCatalog();
    const before = getAircraftCatalogSync().length;
    await prisma.aircraft.create({
      data: { icao: "ZZZ9", name: "Test Aircraft", isUserAdded: true },
    });
    invalidateAircraftCatalogCache();
    await preloadAircraftCatalog();
    expect(getAircraftCatalogSync().length).toBe(before + 1);
    await prisma.aircraft.delete({ where: { icao: "ZZZ9" } });
    invalidateAircraftCatalogCache();
    await preloadAircraftCatalog();
  });
});
