import { prisma } from "../../db";
import {
  getAirlineCatalog,
  invalidateAirlineCatalogCache,
  getAirlineCatalogSync,
  preloadAirlineCatalog,
} from "../airlineCatalogCache";

describe("airlineCatalogCache", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads airlines from the DB and caches them", async () => {
    const first = await getAirlineCatalog();
    expect(first.length).toBeGreaterThan(140);
    expect(first.find((a) => a.iata === "LH")?.name).toBe("Lufthansa");
  });

  it("exposes a sync snapshot after preload", async () => {
    invalidateAirlineCatalogCache();
    expect(getAirlineCatalogSync()).toEqual([]);
    await preloadAirlineCatalog();
    expect(getAirlineCatalogSync().length).toBeGreaterThan(140);
  });

  it("reloads after invalidation", async () => {
    await preloadAirlineCatalog();
    const before = getAirlineCatalogSync().length;
    // NOTE: "ZZ" (the brief's original throwaway code) collides with a real
    // vendored OpenFlights row (id 10224, "Zz", Belgium) — see task-10-report.md.
    // "ZZZ" is a 3-char value no real 2-char IATA code can match.
    await prisma.airline.create({ data: { iata: "ZZZ", name: "Test Air", isUserAdded: true } });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    expect(getAirlineCatalogSync().length).toBe(before + 1);
    await prisma.airline.delete({ where: { iata: "ZZZ" } });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
  });
});
