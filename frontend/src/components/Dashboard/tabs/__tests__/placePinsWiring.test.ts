import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Every map that draws place pins must also hand down what a pin MEANS.
 *
 * The list colour and the list symbol are resolved by the caller and passed in,
 * deliberately — a layer that worked out list membership by itself would be a
 * second place deciding what a pin means. The cost of that choice is that a new
 * map can draw pins and silently forget the two props, which is exactly what
 * happened: the "All" tab drew places with neither, so a list's colour never
 * reached it and, once symbols existed, neither did those. It was reported as
 * "there is no symbol on the map" — from a tab nobody had thought about.
 *
 * The source scan is deliberate. There is no runtime seam here: both props are
 * optional by design (a map with no lists loaded passes nothing), so no test of
 * behaviour can tell "this map has no lists" from "this map forgot".
 */
describe("every map that draws place pins passes the list context", () => {
  const tabsDir = path.join(__dirname, "..");
  const drawsPlaces = fs
    .readdirSync(tabsDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ file: f, source: fs.readFileSync(path.join(tabsDir, f), "utf-8") }))
    .filter((f) => f.source.includes("placesOverride="));

  it("finds the tabs that draw places at all", () => {
    // If this drops to zero the guard below has quietly stopped guarding.
    expect(drawsPlaces.length).toBeGreaterThan(0);
  });

  it.each(drawsPlaces.map((f) => f.file))("%s passes colours and symbols", (file) => {
    const source = drawsPlaces.find((f) => f.file === file)!.source;
    expect(source).toContain("placeListColors=");
    expect(source).toContain("placeListLabels=");
  });
});
