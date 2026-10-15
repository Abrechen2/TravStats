import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const script = path.resolve(__dirname, "../../../../scripts/preview-market-visits.ts");
const run = (args: string[]) =>
  spawnSync(process.execPath, [require.resolve("tsx/cli"), script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      LOG_LEVEL: "error",
      DATABASE_URL: "postgresql://never-contact.invalid/db",
    },
    timeout: 10000,
  });
function files(input: unknown, catalog: unknown) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "market-preview-test-"));
  const source = path.join(folder, "input.json"),
    areas = path.join(folder, "areas.geojson"),
    out = path.join(folder, "output.json");
  fs.writeFileSync(source, JSON.stringify(input));
  fs.writeFileSync(areas, JSON.stringify(catalog));
  return { source, areas, out };
}
const emptyCatalog = { type: "FeatureCollection", features: [] };
it("runs as file-only preview with no usable database connection and private output permissions", () => {
  const f = files({ points: [] }, emptyCatalog);
  const result = run([f.source, f.areas, f.out]);
  expect(result.status).toBe(0);
  const output = JSON.parse(fs.readFileSync(f.out, "utf8"));
  expect(output.previewOnly).toBe(true);
  expect(output.writesToProduction).toBe(0);
  expect(fs.statSync(f.out).mode & 0o777).toBe(0o600);
});
it("refuses to overwrite input or existing evidence", () => {
  const f = files({ points: [] }, emptyCatalog);
  const original = fs.readFileSync(f.source, "utf8");
  expect(run([f.source, f.areas, f.source]).status).not.toBe(0);
  expect(fs.readFileSync(f.source, "utf8")).toBe(original);
});
it("reports point-only markets as missing area evidence", () => {
  const f = files(
    { points: [] },
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: "node/1",
            name: "Market",
            sourceUrl: "https://www.openstreetmap.org/node/1",
            kind: "market",
          },
          geometry: { type: "Point", coordinates: [126, 33] },
        },
      ],
    }
  );
  expect(run([f.source, f.areas, f.out]).status).toBe(0);
  const output = JSON.parse(fs.readFileSync(f.out, "utf8"));
  expect(output.missingAreas).toEqual([{ id: "node/1", name: "Market", reason: "areaMissing" }]);
  expect(output.findings).toEqual([]);
});
it("refuses incomplete tracks instead of claiming a complete trip analysis", () => {
  const f = files({ points: [], truncated: true }, emptyCatalog);
  expect(run([f.source, f.areas, f.out]).status).not.toBe(0);
  expect(fs.existsSync(f.out)).toBe(false);
});
it("does not treat a shop feature as a market", () => {
  const f = files(
    { points: [] },
    {
      type: "FeatureCollection",
      features: [
        { properties: { kind: "shop" }, geometry: { type: "Point", coordinates: [126, 33] } },
      ],
    }
  );
  expect(run([f.source, f.areas, f.out]).status).toBe(0);
  expect(JSON.parse(fs.readFileSync(f.out, "utf8")).missingAreas).toEqual([]);
});
