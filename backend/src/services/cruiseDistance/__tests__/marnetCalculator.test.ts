import {
  marnetCalculator,
  __resetMarnetCache,
} from "../marnetCalculator";
import type { PortPoint } from "../types";

const KIEL: PortPoint = {
  id: 1,
  lat: 54.32,
  lon: 10.14,
  unlocode: "DEKEL",
  region: "baltic",
};
const COPENHAGEN: PortPoint = {
  id: 2,
  lat: 55.68,
  lon: 12.57,
  unlocode: "DKCPH",
  region: "baltic",
};
const VIENNA: PortPoint = {
  id: 99,
  lat: 48.21,
  lon: 16.37,
  unlocode: null,
  region: "river_danube",
};

describe("marnetCalculator", () => {
  beforeEach(() => __resetMarnetCache());

  it("rejects inland ports", () => {
    expect(marnetCalculator.accepts(VIENNA, KIEL)).toBe(false);
    expect(marnetCalculator.accepts(KIEL, VIENNA)).toBe(false);
  });

  it("declines in test mode (so tests can mock instead)", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(marnetCalculator.accepts(KIEL, COPENHAGEN)).toBe(false);
  });

  it("returns null when invoked without a loaded seaRoute (test mode)", async () => {
    await expect(marnetCalculator.compute(KIEL, COPENHAGEN)).resolves.toBeNull();
  });
});
