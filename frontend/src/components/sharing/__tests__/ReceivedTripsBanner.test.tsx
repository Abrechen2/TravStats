import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ receivedTrips: vi.fn(), markReceivedTripsSeen: vi.fn() }));
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: api }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import ReceivedTripsBanner from "../ReceivedTripsBanner";
import { useReceivedTripsStore } from "../../../store/receivedTripsStore";

describe("ReceivedTripsBanner — a shared trip is noticed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReceivedTripsStore.setState({ items: [] });
  });

  it("names an auto-accepted trip and a waiting offer until seen; offers outlive 'seen'", async () => {
    api.receivedTrips.mockResolvedValue({
      count: 2,
      items: [
        {
          kind: "offer",
          id: "o1",
          tripId: null,
          tripName: "Island",
          from: { displayName: "Ben", origin: "https://b.example" },
          autoAccepted: false,
        },
        {
          kind: "shared",
          id: "n1",
          tripId: "t1",
          tripName: "Antarktis 2027",
          from: { displayName: "Anna", origin: null },
          autoAccepted: true,
        },
      ],
    });
    api.markReceivedTripsSeen.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <ReceivedTripsBanner />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("received-trips-banner")).toBeInTheDocument();
    expect(screen.getByText("sharing:receivedBanner.autoAccepted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "sharing:receivedBanner.open" })).toHaveAttribute(
      "href",
      "/trips/t1"
    );
    fireEvent.click(screen.getByRole("button", { name: "sharing:receivedBanner.seen" }));
    await waitFor(() => expect(api.markReceivedTripsSeen).toHaveBeenCalled());
    expect(useReceivedTripsStore.getState().items.map((i) => i.id)).toEqual(["o1"]);
  });
});
