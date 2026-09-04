import { describe, it, expect } from "vitest";
import de from "../resources/de/dashboard.json";
import en from "../resources/en/dashboard.json";

/**
 * #272 — the map key read "Flüge (geflogen)" beside "Flughafen" and "Hafen":
 * every row names a KIND of thing on the map, so every row is plural. The fix
 * changed two strings and nothing held them; a later edit could put the
 * singular back without a test going red.
 */
describe("map legend copy agrees in number (#272)", () => {
  const legend = (bundle: { legend: Record<string, string> }): Record<string, string> =>
    bundle.legend;

  it("names airports and ports in the plural, like the flight rows beside them", () => {
    expect(legend(de).airport).toBe("Flughäfen");
    expect(legend(de).port).toBe("Häfen");
    expect(legend(en).airport).toBe("Airports");
    expect(legend(en).port).toBe("Ports");
  });

  it("never lets the singular of those two back in, in either language", () => {
    const singular = new Set(["Flughafen", "Hafen", "Airport", "Port"]);
    const values = [...Object.values(legend(de)), ...Object.values(legend(en))];
    expect(values.filter((v) => singular.has(v))).toEqual([]);
  });
});
