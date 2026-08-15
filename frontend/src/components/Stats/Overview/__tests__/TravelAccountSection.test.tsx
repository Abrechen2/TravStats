import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { TravelAccountResponse } from "../../../../types/travelAccount";

const getTravelAccount = vi.fn();
vi.mock("../../../../lib/api/stats", () => ({
  statsApi: { getTravelAccount: () => getTravelAccount() },
}));

import TravelAccountSection from "../TravelAccountSection";

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
    render(<TravelAccountSection />);
    return waitFor(() => {
      expect(screen.getByText("11 %")).toBeTruthy();
    });
  });

  it("renders nothing at all when the request fails", async () => {
    // The rest of the overview is still correct; a red box beside correct
    // figures reads as if they were affected too.
    getTravelAccount.mockRejectedValue(new Error("boom"));
    const { container } = render(<TravelAccountSection />);
    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
  });

  it("renders nothing when there is no year with data", async () => {
    getTravelAccount.mockResolvedValue(
      response({ account: { years: [], contestedNights: 0 } })
    );
    const { container } = render(<TravelAccountSection />);
    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
  });

  it("mentions contested nights only when there are any", async () => {
    getTravelAccount.mockResolvedValue(response());
    const first = render(<TravelAccountSection />);
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
    render(<TravelAccountSection />);
    await waitFor(() => {
      expect(screen.getByText(/travelAccount\.contested/)).toBeTruthy();
    });
  });

  it("shows how many trips are fully covered against how many have dates", async () => {
    getTravelAccount.mockResolvedValue(response());
    render(<TravelAccountSection />);
    await waitFor(() => {
      expect(screen.getByText("3 / 4")).toBeTruthy();
    });
  });
});
