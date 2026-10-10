import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Forgejo #254. A connection is the unordered airport pair everywhere on the
 * statistics page - except here: the punctuality tile groups by the DIRECTED
 * leg (delays depend on which airport you leave from), so FRA-JFK and JFK-FRA
 * are two entries. A directed view must say so in its copy, in both languages,
 * or it reads as a second answer to "which route" next to Route Master.
 */
const RESOURCES = path.resolve(__dirname, "..", "..", "..", "i18n", "resources");
const copy = (locale: "de" | "en"): string =>
  (
    JSON.parse(fs.readFileSync(path.join(RESOURCES, locale, "stats.json"), "utf8")) as {
      punctuality: { worstRoute: string };
    }
  ).punctuality.worstRoute;

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "stats:punctuality.worstRoute" ? copy("en") : (key.split(".").pop() ?? key),
  }),
}));

import PunctualitySection from "../PunctualitySection";

describe("punctuality tile - per direction (forgejo#254)", () => {
  it("says in German that the route is counted per direction", () => {
    expect(copy("de")).toMatch(/je Richtung/);
  });

  it("says in English that the route is counted per direction", () => {
    expect(copy("en")).toMatch(/per direction/);
  });

  it("renders that label on the tile", () => {
    render(
      <MemoryRouter>
        <PunctualitySection
          stats={{
            sampleSize: 4,
            avgDelayMinutes: 10,
            onTimeRate: 0.5,
            bestAirline: null,
            worstAirline: null,
            worstRoute: { key: "FRA-JFK", avgDelayMinutes: 30, flights: 2 },
          }}
        />
      </MemoryRouter>
    );
    // On the tile itself — the counting help below may say it too.
    const tiles = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(tiles.some((text) => /per direction/.test(text))).toBe(true);
  });
});
