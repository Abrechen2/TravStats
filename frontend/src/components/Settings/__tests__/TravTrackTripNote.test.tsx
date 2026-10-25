import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { germanUseTranslation } from "../../../__tests__/helpers/germanT";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));

import TravTrackTripNote from "../TravTrackTripNote";
import { settingsApi, type HomePeriod } from "../../../lib/api/settings";

/**
 * Why TravTrack asks about no trip (TravTrack plan L4): without a confirmed
 * residence nothing is inferred, and the settings line says so — and only
 * then.
 */

const period = (confirmed: boolean): HomePeriod => ({
  fromDate: "2020-01-01",
  toDate: null,
  residence: { name: "Frankfurt", lat: 50.11, lon: 8.68 },
  residenceConfirmed: confirmed,
  airports: [{ code: "FRA", primary: true }],
});

describe("TravTrackTripNote", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("says why no trip is inferred without a confirmed residence", async () => {
    vi.spyOn(settingsApi, "getHomeAirports").mockResolvedValue({
      history: [],
      periods: [period(false)],
    });
    render(<TravTrackTripNote />);
    expect(await screen.findByTestId("travtrack-trips-no-residence")).toHaveTextContent(
      /Wohnort bestätigt/
    );
  });

  it("says nothing once the residence is confirmed", async () => {
    const read = vi.spyOn(settingsApi, "getHomeAirports").mockResolvedValue({
      history: [],
      periods: [period(true)],
    });
    render(<TravTrackTripNote />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("travtrack-trips-no-residence")).toBeNull();
  });

  it("claims nothing when the home periods cannot be read", async () => {
    const read = vi
      .spyOn(settingsApi, "getHomeAirports")
      .mockRejectedValue(new Error("network down"));
    render(<TravTrackTripNote />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("travtrack-trips-no-residence")).toBeNull();
  });
});
