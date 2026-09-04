import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { TRIP_GRID_CLASS } from "../tripGrid";
import { TripInsightsBar } from "../TripInsightsBar";
import type { Trip } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const trip = (over: Partial<Trip>): Trip =>
  ({
    id: "t1",
    name: "Reise",
    status: "completed",
    startDate: "2024-01-01",
    endDate: "2024-01-10",
    countries: ["DE", "FR", "IT"],
    flights: [],
    cruises: [],
    stops: [],
    photos: [],
    ...over,
  }) as unknown as Trip;

/**
 * #271 — the insights tiles and the trip cards under them sat on different
 * grids, so their column edges did not line up. Both read one class now.
 */
describe("TripInsightsBar — the grid the trip cards use (#271)", () => {
  it("lays the tiles out on the shared trip grid", () => {
    const { container } = render(
      <TripInsightsBar
        trips={[
          trip({ id: "a", countries: ["DE", "FR", "IT"] }),
          trip({ id: "b", countries: ["DE"] }),
        ]}
      />
    );
    const grid = container.querySelector(`.${TRIP_GRID_CLASS.split(" ")[0]}`);
    expect(grid).not.toBeNull();
    for (const cls of TRIP_GRID_CLASS.split(" ")) {
      expect(grid?.classList.contains(cls), cls).toBe(true);
    }
  });

  it("is the same string the trip cards are laid out with", () => {
    const tripsTab = readFileSync(join(__dirname, "..", "TripsTab.tsx"), "utf8");
    expect(tripsTab).toMatch(/TRIP_GRID_CLASS/);
    expect(tripsTab).not.toMatch(/grid-cols-1 md:grid-cols-2 lg:grid-cols-3/);
  });
});
