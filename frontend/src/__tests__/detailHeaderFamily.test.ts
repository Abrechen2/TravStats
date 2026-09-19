import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-08, as a test: "the switch to the detail brings a different head."
 *
 * The four entry details had drifted into four answers to one question, and
 * not one of the differences was asked for by the content — which is the test
 * the handoff sets. Measured before `DetailHeader` existed:
 *
 * | | flight | cruise | lodging | place |
 * |---|---|---|---|---|
 * | frame | card | card | card | none |
 * | width | max-w-6xl | max-w-6xl | max-w-6xl | max-w-[1100px] |
 * | mark | 48px tile | 48px tile | 48px tile | inside the h1 |
 * | status | pill | pill + 3 boxes | none | own pill, own colours |
 * | back | button | button | button | muted link |
 *
 * A source scan rather than a render: what this guards is that no page draws
 * its own head again. The rendered result is covered by each page's own test
 * and was checked in a browser.
 */
const PAGES = ["FlightDetailPage", "CruiseDetailPage", "LodgingDetailPage", "PlaceDetailPage"];

const read = (name: string): string =>
  readFileSync(resolve(__dirname, "..", "pages", `${name}.tsx`), "utf8");

describe("one detail head for the four domains", () => {
  it.each(PAGES)("%s renders DetailHeader", (name) => {
    expect(read(name)).toContain("<DetailHeader");
  });

  it.each(PAGES)("%s builds no head of its own", (name) => {
    const src = read(name);
    // The h1 belongs to the primitive now. A page that still writes one has
    // either kept its old head or grown a second.
    expect(src).not.toContain("<h1");
    // The 48px domain tile, the shape three of the four hand-rolled.
    expect(src).not.toContain("h-12 w-12");
  });

  it.each(PAGES)("%s names no width of its own", (name) => {
    // `AppShell` owns the width. Four pages, three different `max-w-*`
    // values, was how "the same application" stopped looking like one.
    expect(read(name)).not.toMatch(/max-w-(6xl|\[\d+px\])/);
  });
});
