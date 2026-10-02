import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const suggestions = vi.fn();
const setRoadtrip = vi.fn();
vi.mock("../../../lib/api/rentalLinks", () => ({
  rentalLinksApi: {
    suggestions: (...a: unknown[]) => suggestions(...a),
    setRoadtrip: (...a: unknown[]) => setRoadtrip(...a),
  },
}));
vi.mock("../../../lib/api/rental", () => ({ rentalApi: { update: vi.fn() } }));

import { RentalSuggestionBanner } from "../RentalSuggestionBanner";
import { makeRental } from "./rentalFixture";

const ROADTRIP = {
  id: "r1",
  name: "Testroute",
  vehicle: "car",
  vehicleName: null,
  hasRental: false,
};

beforeEach(() => {
  suggestions.mockReset();
  setRoadtrip.mockReset();
});

describe("RentalSuggestionBanner", () => {
  it("hands the station offer up, since the reload after linking unmounts the banner", async () => {
    suggestions.mockResolvedValueOnce({ trips: [], roadtrips: [ROADTRIP] });
    setRoadtrip.mockResolvedValueOnce({
      rental: makeRental({ routeId: "r1" }),
      stationOffer: {
        first: { name: "Start A", lat: 1, lon: 2 },
        last: { name: "End B", lat: 3, lon: 4 },
      },
    });
    const onChanged = vi.fn();
    const onStationOffer = vi.fn();
    render(
      <RentalSuggestionBanner
        rental={makeRental()}
        onChanged={onChanged}
        onStationOffer={onStationOffer}
      />
    );
    fireEvent.click(await screen.findByText("rental:suggest.linkRoadtrip"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onStationOffer).toHaveBeenCalledWith("rental:suggest.stationOffer");
  });

  it("says a failed link instead of looking like nothing to suggest", async () => {
    suggestions.mockResolvedValueOnce({ trips: [], roadtrips: [ROADTRIP] });
    setRoadtrip.mockRejectedValueOnce(new Error("500"));
    const onChanged = vi.fn();
    render(
      <RentalSuggestionBanner
        rental={makeRental()}
        onChanged={onChanged}
        onStationOffer={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByText("rental:suggest.linkRoadtrip"));
    expect(await screen.findByRole("alert")).toHaveTextContent("rental:suggest.failed");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
