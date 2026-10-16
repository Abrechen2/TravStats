import fs from "fs";
import path from "path";

import { computeLegDistance } from "../index";
import { riverLegPath } from "../riverCalculator";
import type { PortPoint } from "../types";

/**
 * The distance half of the Nile fix (prod, 2026-10-16): the map line and the
 * kilometres answer "is this leg inland?" with the same rule
 * (`inlandLeg.ts`), and the river anchors are in the image to measure on.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const nile = (id: number, lat: number, lon: number, region: string | null): PortPoint => ({
  id,
  lat,
  lon,
  unlocode: null,
  region,
  name: `Port ${id}`,
  city: null,
  country: "Egypt",
});

describe("a river cruise never reaches the sea router", () => {
  const env = process.env.NODE_ENV;
  // The chain keeps the sea router out of the suite; this test is about it.
  beforeAll(() => {
    process.env.NODE_ENV = "development";
  });
  afterAll(() => {
    process.env.NODE_ENV = env;
  });

  it("measures a river cruise between ports without a river region as the chord", async () => {
    // A user-added Nile port carries no region; on an ocean cruise the sea
    // router would take it, on a river cruise it must not.
    const luxor = nile(1, 25.6872, 32.6396, null);
    const aswan = nile(2, 24.0889, 32.8997, null);
    const leg = await computeLegDistance(luxor, aswan, { cruiseKind: "river" });
    expect(leg.method).toBe("haversine");
  });

  it("measures two Nile catalogue ports along the river", async () => {
    const luxor = nile(1, 25.6872, 32.6396, "river_nile");
    const aswan = nile(2, 24.0889, 32.8997, "river_nile");
    const leg = await computeLegDistance(luxor, aswan, { cruiseKind: "river" });
    expect(leg.method).toBe("river-osm");
  });
});

describe("the river line", () => {
  it("runs upstream in the leg's own direction", async () => {
    const edfu = nile(3, 24.9781, 32.8731, "river_nile");
    const luxor = nile(1, 25.6872, 32.6396, "river_nile");
    expect(await riverLegPath(edfu, luxor)).toEqual([
      [32.8731, 24.9781],
      [32.5536, 25.2933],
      [32.6396, 25.6872],
    ]);
  });

  it("declines ports on different rivers, as the distance does", async () => {
    const luxor = nile(1, 25.6872, 32.6396, "river_nile");
    const basel = { ...nile(4, 47.5594, 7.5886, "river_rhine"), country: "Switzerland" };
    expect(await riverLegPath(luxor, basel)).toBeNull();
  });
});

describe("the production image", () => {
  it("copies the river anchors in — without them every river leg measured as the chord", () => {
    // riverCalculator reads data/rivers via __dirname and treats a missing
    // directory as "no rivers" with a warn, so prod stored every Nile leg as
    // `haversine` while the repository's tests measured it along the river.
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf-8");
    const copies = dockerfile
      .split(/\r?\n/)
      .filter((line) => line.startsWith("COPY ") && line.includes("backend/data/rivers"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/\.\/data\/rivers\/?$/);
  });
});
