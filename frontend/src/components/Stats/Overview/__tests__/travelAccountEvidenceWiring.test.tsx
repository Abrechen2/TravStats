import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { TravelAccountResponse } from "../../../../types/travelAccount";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";

const getTravelAccount = vi.fn();
vi.mock("../../../../lib/api/stats", () => ({
  statsApi: { getTravelAccount: () => getTravelAccount() },
}));

import TravelAccountSection from "../TravelAccountSection";

/**
 * Which travel-account tiles open the evidence panel (task 7b-2), read from
 * the URL the tile itself writes — `?evidence=metric:<key>` is the whole
 * contract between a tile and the panel, so one wired to the wrong key looks
 * identical to a correct one until it is clicked.
 *
 * Seven of this section's nine served keys are deliberately NOT wired, and
 * the absences are asserted so the state stays a decision rather than an
 * oversight:
 *
 *  - **The five night keys** (`hotel`, `sea`, `air`, `home`, `contested`).
 *    The section draws nights as PER-YEAR bars with a legend. There is no
 *    all-time night figure on screen to attach a trigger to, and all five are
 *    registered `allTime`. `contested` is the near miss — it renders as a
 *    count inside the subtitle prose — but turning a sentence fragment into a
 *    button is a decision about this surface, not a wiring one.
 *  - **`travelAccountFullyCoveredTripCount` + `travelAccountTripsWithDatesCount`.**
 *    One card, two numbers ("3 / 4"), and a `StatCard` opens ONE panel. The
 *    same ruling the east/west and international/domestic pairs got on the
 *    unique tab, for the same reason.
 *
 * All seven remain served and reachable by `?evidence=metric:<key>`.
 */

const response = (): TravelAccountResponse => ({
  account: {
    years: [
      { year: "2025", days: 365, hotelNights: 30, seaNights: 7, airNights: 3, homeNights: 325 },
    ],
    contestedNights: 2,
  },
  trips: {
    trips: [],
    tripsWithDates: 4,
    fullyCoveredTrips: 3,
    totalUncoveredDays: 9,
    avgTripDays: 6.5,
    longestTripDays: 14,
    byCategory: [],
    byTag: [],
    moods: [],
    weather: [],
    journalEntries: 12,
  },
});

/** Reports the search string after each click — `MemoryRouter` never touches `window.location`. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

async function keysOpened(): Promise<string[]> {
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      <TravelAccountSection />
      <LocationProbe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  // The section fetches for itself, so the cards do not exist until it
  // resolves — `getAllByRole` on the first tick would find nothing and the
  // test would pass by measuring an empty page.
  await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));

  const keys: string[] = [];
  for (const trigger of screen.getAllByRole("button")) {
    await act(async () => {
      trigger.click();
    });
    const raw = new URLSearchParams(search).get("evidence") ?? "";
    keys.push(raw.slice(raw.indexOf(":") + 1));
  }
  return keys.sort();
}

describe("the travel-account tiles open the measures they render", () => {
  beforeEach(() => {
    getTravelAccount.mockReset();
    getTravelAccount.mockResolvedValue(response());
  });

  it("wires exactly the two single-number trip cards", async () => {
    expect(await keysOpened()).toEqual(
      ["travelAccountJournalEntryCount", "travelAccountUncoveredDayCount"].sort()
    );
  });

  it("leaves the five night measures unwired — this section has no all-time night figure", async () => {
    const keys = await keysOpened();
    for (const key of [
      "travelAccountHotelNights",
      "travelAccountSeaNights",
      "travelAccountAirNights",
      "travelAccountHomeNights",
      "travelAccountContestedNights",
    ]) {
      expect([key, keys]).toEqual([key, expect.not.arrayContaining([key])]);
    }
  });

  it("leaves the two-number coverage card unwired — a card opens ONE panel", async () => {
    const keys = await keysOpened();
    expect(keys).not.toContain("travelAccountFullyCoveredTripCount");
    expect(keys).not.toContain("travelAccountTripsWithDatesCount");
    // `avgTripDays` is a `ratio`, which release 1 does not serve at all.
    expect(keys).not.toContain("travelAccountAvgTripDays");
  });

  it("every key this section opens is a registered measure that release 1 serves", async () => {
    const keys = await keysOpened();
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
  });
});
