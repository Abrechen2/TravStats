import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { FunStats, UniqueStats } from "../../../types";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import StatsFunSection from "../StatsFunSection";
import StatsUniqueSection from "../StatsUniqueSection";

/**
 * Which tiles on the fun and unique surfaces open the evidence panel
 * (task 7b-1), read from the URL the tile itself writes rather than from a
 * prop — `?evidence=metric:<key>` is the whole contract between a tile and
 * the panel, so a tile wired to the wrong key looks identical to a correct
 * one until it is clicked.
 *
 * The second assertion is the one that would have caught the defect this
 * feature keeps producing: every key a tile opens must be a REGISTERED
 * measure that release 1 serves. Wiring a tile to an unregistered or
 * release-2 key ships a pointer cursor over a 404 (GitHub #330 with an extra
 * round trip). The converse — a resolver with no tile — is not checked here;
 * `backend/src/services/evidence/__tests__/registryBinding.test.ts` holds
 * that side.
 */

const funStats: FunStats = {
  timezoneHopper: 3,
  earlyBird: 4,
  afternoon: 5,
  nightOwl: 2,
  weekendWarrior: 6,
  weekendPercentage: 40,
  loyaltyScore: 55,
  mostUsedAirline: "Lufthansa",
  shortHaulKing: 7,
  longHaulPilot: 8,
  fastestDay: "2025-06-14",
  fastestDayFlights: 3,
  co2FootprintKg: 12345,
  co2InElephants: 3.1,
  milestoneYear: 2025,
  milestoneYearFlights: 20,
  routeMaster: "FRA-LHR",
  routeMasterCount: 9,
};

const uniqueStats: UniqueStats = {
  timeTravelIndex: 2,
  equatorCrossings: 1,
  arcticFlights: 1,
  oceanCrossings: 4,
  highestAirport: { code: "LPB", name: "El Alto", altitude: 4061 },
  northernmost: { lat: 67.01, code: "SFJ" },
  southernmost: { lat: -33.95, code: "SYD" },
  longestTravelChain: 3,
  fastestRoute: { route: "FRA-JFK", speed: 880 },
  mostCountriesInDay: 3,
  mostCountriesDate: "2025-06-10",
  hemisphereHops: 1,
  dateLineCrossings: 1,
  continentalExplorer: 3,
  continents: ["Europe", "North America", "Asia"],
  tropicsTraveler: 1,
  eastWestBalance: { eastward: 3, westward: 3, ratio: 1 },
  sameDayFlights: 3,
  midnightFlights: 2,
  seasonalExplorer: true,
  seasonsCount: 4,
  internationalVsDomestic: { international: 5, domestic: 1, ratio: 5 },
  longestLayover: { hours: 6.5, from: "FRA", to: "FRA" },
  shortestLayover: { hours: 1.2, from: "LHR", to: "LHR" },
  roundTripMaster: 1,
};

/** Reports the search string after each click, since `MemoryRouter` never touches `window.location`. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

async function keysOpenedBy(section: JSX.Element): Promise<string[]> {
  // `screen` queries the whole document, so a previous render's buttons would
  // still be found here and would click a router this closure cannot see.
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      {section}
      <LocationProbe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  const triggers = screen.getAllByRole("button");
  const keys: string[] = [];
  for (const trigger of triggers) {
    await act(async () => {
      trigger.click();
    });
    const raw = new URLSearchParams(search).get("evidence") ?? "";
    keys.push(raw.slice(raw.indexOf(":") + 1));
  }
  return keys.sort();
}

describe("the fun and unique tiles open the measures they render", () => {
  it("StatsFunSection wires its seven served tiles and leaves the ratio and extremum ones alone", async () => {
    const keys = await keysOpenedBy(<StatsFunSection funStats={funStats} />);
    expect(keys).toEqual(
      [
        "co2FootprintKg",
        "earlyBirdFlightCount",
        "longHaulFlightCount",
        "nightOwlFlightCount",
        "shortHaulFlightCount",
        "timezoneHopperFlightCount",
        "weekendFlightCount",
      ].sort()
    );
  });

  it("StatsUniqueSection wires its eleven single-number tiles and both split cards", async () => {
    const keys = await keysOpenedBy(<StatsUniqueSection uniqueStats={uniqueStats} />);
    expect(keys).toEqual(
      [
        "arcticFlightCount",
        "continentsTouchedByFlightCount",
        "dateLineCrossingCount",
        "equatorCrossingCount",
        "hemisphereHopCount",
        "midnightFlightCount",
        "oceanCrossingCount",
        "roundTripFlightCount",
        "sameDayFlightCount",
        "timeTravelFlightCount",
        "tropicsFlightCount",
        // The east/west and international/domestic cards render TWO numbers
        // each. They were unwired until the owner ruled on 2026-09-19 that a
        // two-figure card gets a trigger per figure; these four assertions used
        // to read `not.toContain`.
        "eastwardFlightCount",
        "westwardFlightCount",
        "internationalFlightCount",
        "domesticFlightCount",
      ].sort()
    );
  });

  /**
   * The failure a key-set assertion cannot see: both figures of one card
   * wired to the SAME key. The set would still contain both keys — one from
   * each card — and every button would still open a panel.
   */
  it("opens a DIFFERENT measure from each figure of a split card", async () => {
    const keys = await keysOpenedBy(<StatsUniqueSection uniqueStats={uniqueStats} />);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key these surfaces open is a registered measure that release 1 serves", async () => {
    const keys = [
      ...(await keysOpenedBy(<StatsFunSection funStats={funStats} />)),
      ...(await keysOpenedBy(<StatsUniqueSection uniqueStats={uniqueStats} />)),
    ];
    const unserved = keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1);
    expect(unserved).toEqual([]);
  });
});
