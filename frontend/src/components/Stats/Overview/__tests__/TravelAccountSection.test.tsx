import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { JSX } from "react";
import type { TravelAccountResponse } from "../../../../types/travelAccount";

const getTravelAccount = vi.fn();
vi.mock("../../../../lib/api/stats", () => ({
  statsApi: { getTravelAccount: () => getTravelAccount() },
}));

import TravelAccountSection from "../TravelAccountSection";

/**
 * Two of the four trip cards are evidence triggers since task 7b-2, and
 * `EvidenceTrigger` reads the URL — so the section needs a router around it
 * the way it has one in the app.
 */
const withRouter = (): JSX.Element => (
  <MemoryRouter>
    <TravelAccountSection />
  </MemoryRouter>
);

const response = (over: Partial<TravelAccountResponse> = {}): TravelAccountResponse => ({
  account: {
    years: [
      { year: "2025", days: 365, hotelNights: 30, seaNights: 7, airNights: 3, homeNights: 325 },
    ],
    contestedNights: 0,
  },
  trips: {
    trips: [],
    tripsWithDates: 4,
    fullyCoveredTrips: 3,
    totalUncoveredDays: 7,
    avgTripDays: 6.5,
    longestTripDays: 14,
    byCategory: [],
    byTag: [],
    moods: [],
    weather: [],
    journalEntries: 12,
  },
  ...over,
});

describe("TravelAccountSection", () => {
  beforeEach(() => {
    getTravelAccount.mockReset();
  });

  it("shows the away share against the whole year", () => {
    // 40 of 365 nights away — the bar is the year, so the figure is a share.
    getTravelAccount.mockResolvedValue(response());
    render(withRouter());
    return waitFor(() => {
      expect(screen.getByText("11 %")).toBeTruthy();
    });
  });

  it("renders nothing at all when the request fails", async () => {
    // The rest of the overview is still correct; a red box beside correct
    // figures reads as if they were affected too.
    getTravelAccount.mockRejectedValue(new Error("boom"));
    const { container } = render(withRouter());
    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
  });

  it("renders nothing when there is no year with data", async () => {
    getTravelAccount.mockResolvedValue(response({ account: { years: [], contestedNights: 0 } }));
    const { container } = render(withRouter());
    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
  });

  it("mentions contested nights only when there are any", async () => {
    getTravelAccount.mockResolvedValue(response());
    const first = render(withRouter());
    await waitFor(() => {
      expect(screen.queryByText(/travelAccount\.contested/)).toBeNull();
    });
    first.unmount();

    getTravelAccount.mockResolvedValue(
      response({
        account: {
          years: [
            {
              year: "2025",
              days: 365,
              hotelNights: 30,
              seaNights: 7,
              airNights: 3,
              homeNights: 325,
            },
          ],
          contestedNights: 2,
        },
      })
    );
    render(withRouter());
    await waitFor(() => {
      expect(screen.getByText(/travelAccount\.contested/)).toBeTruthy();
    });
  });

  it("shows how many trips are fully covered against how many have dates", async () => {
    getTravelAccount.mockResolvedValue(response());
    render(withRouter());
    // Since 2026-09-19 the pair is two triggers with a plain slash between
    // them, not the single string "3 / 4" — so each figure is looked up by
    // the name it announces rather than by the concatenation.
    const covered = await screen.findByRole("button", {
      name: "stats:travelAccount.tripsCoveredFully",
    });
    const withDates = screen.getByRole("button", {
      name: "stats:travelAccount.tripsCoveredWithDates",
    });
    expect(covered).toHaveTextContent("3");
    expect(withDates).toHaveTextContent("4");
    await waitFor(() => {
      expect(screen.getByText("stats:travelAccount.tripsCoveredDesc")).toBeTruthy();
    });
  });
});
