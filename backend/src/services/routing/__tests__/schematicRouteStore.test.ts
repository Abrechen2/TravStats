import fs from "fs/promises";
import os from "os";
import path from "path";
import { dataFingerprint, schematicRouteVersion } from "../schematicRouteStore";

describe("sea route data version", () => {
  // Stored sea routes outlived every update of the shipping-lane graph and land
  // mask, because the key named only a fixed policy string.
  it("changes when a data file changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sea-version-"));
    try {
      const a = path.join(directory, "marnet.geojson"),
        b = path.join(directory, "land-mask.bin");
      await fs.writeFile(a, "graph-1");
      await fs.writeFile(b, "mask");
      const before = dataFingerprint([a, b]);
      expect(dataFingerprint([a, b])).toBe(before);
      await fs.writeFile(a, "graph-2");
      expect(dataFingerprint([a, b])).not.toBe(before);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("names the policy and the vendored data in the key", () => {
    expect(schematicRouteVersion()).toMatch(/^schematic-v1:[0-9a-f]{16}$/);
  });
});
