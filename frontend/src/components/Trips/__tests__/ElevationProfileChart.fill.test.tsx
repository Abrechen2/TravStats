import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import ElevationProfileChart from "../ElevationProfileChart";
import { TOKENS_PATH } from "../../../../scripts/generate-theme.mjs";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

/**
 * Round 29 (B3, forgejo#131): an elevation profile is drawn in the domain
 * colour — the line in the hue, the area under it in the same hue at the
 * token's alpha, never `chartColors`. The alpha is read from
 * `design/tokens.json` (`elevationProfile.fill = "domain@<alpha>"`) so the test
 * follows the token rather than restating it.
 */
const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as {
  elevationProfile: { stroke: string; fill: string };
};
const fillAlpha = Number(tokens.elevationProfile.fill.split("@")[1]);

const POINTS: [number, number][] = [
  [0, 120],
  [4, 310],
  [9, 180],
];
const HUE = "#123456";

function paths(dashed: boolean): SVGPathElement[] {
  const { container } = render(
    <ElevationProfileChart points={POINTS} accent={HUE} dashed={dashed} />
  );
  return Array.from(container.querySelectorAll("path"));
}

describe("ElevationProfileChart — the domain colour", () => {
  it("fills a measured profile in the hue at the token's alpha", () => {
    expect(tokens.elevationProfile.stroke).toBe("domain");
    const [area, line] = paths(false);
    expect(area.getAttribute("fill")).toBe(HUE);
    expect(Number(area.getAttribute("fill-opacity"))).toBe(fillAlpha);
    expect(line.getAttribute("stroke")).toBe(HUE);
  });

  it("keeps a planned profile lighter than a measured one", () => {
    const [area] = paths(true);
    expect(Number(area.getAttribute("fill-opacity"))).toBeLessThan(fillAlpha);
  });
});
