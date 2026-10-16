import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { recomputeLegsForCruise } from "../../services/cruiseDistance/cruiseLegService";

/**
 * Prod, 2026-10-16: a Nile cruise's `/geometry` routed every leg from the
 * river out to the Red Sea near Safaga and back, the nights in port drew a
 * spike to the same coast, and the cruise page labelled the legs "computed
 * sea route". The map, the stored kilometres and the label now say one thing.
 */

const RED_SEA_COAST_LON = 33.9;

describe("a river cruise through the API", () => {
  let cookie: string;
  let userId: string;
  let portIds: number[] = [];
  let cruiseId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rivergeom" } });
    const u = await prisma.user.create({
      data: { username: "rivergeom", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;

    // User-added rows, so no catalogue unlocode is touched.
    const nile: Array<[string, number, number]> = [
      ["RiverGeom Luxor", 25.6872, 32.6396],
      ["RiverGeom Edfu", 24.9781, 32.8731],
      ["RiverGeom Aswan", 24.0889, 32.8997],
    ];
    const ports = await Promise.all(
      nile.map(([name, lat, lon]) =>
        prisma.port.create({
          data: { name, lat, lon, region: "river_nile", isUserAdded: true },
        })
      )
    );
    portIds = ports.map((p) => p.id);

    const [luxor, edfu, aswan] = portIds;
    const c = await prisma.cruise.create({
      data: {
        userId,
        kind: "river",
        status: "completed",
        stops: {
          create: [luxor, luxor, edfu, aswan, aswan].map((portId, i) => ({
            portId,
            dayNumber: i + 1,
            isAtSea: false,
          })),
        },
      },
    });
    cruiseId = c.id;
    await recomputeLegsForCruise(cruiseId);
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  it("draws the legs along the river and the nights in port not at all", async () => {
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const features = res.body.data.features as Array<{
      geometry: { coordinates: [number, number][] };
      properties: { fromPortId: number; toPortId: number; method: string };
    }>;
    const [luxor, edfu, aswan] = portIds;
    expect(features.map((f) => [f.properties.fromPortId, f.properties.toPortId])).toEqual([
      [luxor, edfu],
      [edfu, aswan],
    ]);
    for (const f of features) {
      expect(f.properties.method).toBe("river_line");
      for (const [lon] of f.geometry.coordinates) expect(lon).toBeLessThan(RED_SEA_COAST_LON);
    }
  });

  it("measures along the river and labels the legs as the river", async () => {
    const legs = await prisma.cruiseLeg.findMany({
      where: { cruiseId },
      orderBy: { ordinal: "asc" },
    });
    expect(legs.map((l) => l.method)).toEqual(["river-osm", "river-osm", "river-osm", "river-osm"]);
    expect(legs[0].distanceKm).toBe(0);
    expect(legs[3].distanceKm).toBe(0);

    const res = await request(app).get(`/api/v1/cruises/${cruiseId}/tracks`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const sources = (res.body.data.legs as Array<{ geometrySource: string }>).map(
      (l) => l.geometrySource
    );
    expect(sources).toEqual(["river", "river", "river", "river"]);
  });
});
