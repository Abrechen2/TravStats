import { describe, expect, it } from "vitest";

import { formatShortDistance } from "../lib/units";

/**
 * The gap between a photo stop and a logged visit (forgejo#211). It follows
 * the reader's distance unit like every other distance, and it must not round
 * a short gap to zero: "0 km" would say the two places coincide.
 */
const t = (key: string): string =>
  ({
    "stats:distance.kilometers": "km",
    "stats:distance.miles": "mi",
    "stats:distance.nautical_miles": "nmi",
  })[key] ?? key;

describe("formatShortDistance", () => {
  it("gives metres below a kilometre, one decimal above, in the app's language", () => {
    expect(formatShortDistance(0.35, "kilometers", t, "de")).toBe("350 m");
    expect(formatShortDistance(1.3, "kilometers", t, "de")).toBe("1,3 km");
    expect(formatShortDistance(1.3, "kilometers", t, "en")).toBe("1.3 km");
  });

  it("follows miles and nautical miles, and never prints zero", () => {
    expect(formatShortDistance(1.3, "miles", t, "en")).toBe("0.8 mi");
    expect(formatShortDistance(0.05, "miles", t, "en")).toBe("0.1 mi");
    expect(formatShortDistance(1.3, "nautical_miles", t, "en")).toBe("0.7 nmi");
  });
});
