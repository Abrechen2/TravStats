import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * forgejo#344. `/airports/search` is public and ran two sequential scans of the
 * whole catalogue per keystroke: the '%q%' ILIKE arms cannot use a btree, and
 * `mode: "insensitive"` equality on the code became an ILIKE too.
 */
describe("GET /airports/search — index support (forgejo#344)", () => {
  beforeAll(async () => {
    await prisma.airport.deleteMany({ where: { iata: "ZQX" } });
    await prisma.airport.create({
      data: {
        iata: "ZQX",
        icao: "ZZQX",
        name: "Quxington Regional",
        city: "Quxville",
        country: "DE",
        lat: 50,
        lon: 8,
      },
    });
  });

  afterAll(async () => {
    await prisma.airport.deleteMany({ where: { iata: "ZQX" } });
    await prisma.$disconnect();
  });

  it("has trigram GIN indexes on name and city that serve a substring ILIKE", async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN SELECT id FROM airports WHERE name ILIKE '%quxing%' OR city ILIKE '%quxvi%'`
      );
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/airports_name_trgm_idx/);
    expect(text).toMatch(/airports_city_trgm_idx/);
  });

  it("finds an airport by a lower-case code through the case-sensitive exact branch", async () => {
    const res = await request(app).get("/api/v1/airports/search").query({ q: "zqx" });
    expect(res.status).toBe(200);
    expect(res.body[0].iata).toBe("ZQX");
    expect(res.body.filter((a: { iata: string }) => a.iata === "ZQX")).toHaveLength(1);
  });

  it("finds an airport by a name fragment", async () => {
    const res = await request(app).get("/api/v1/airports/search").query({ q: "uxingt" });
    expect(res.body.map((a: { iata: string }) => a.iata)).toContain("ZQX");
  });
});
