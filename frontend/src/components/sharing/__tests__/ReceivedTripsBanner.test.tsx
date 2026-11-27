import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ receivedTrips: vi.fn(), markReceivedTripsSeen: vi.fn() }));
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: api }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import ReceivedTripsBanner, { OVER_MAP_Z } from "../ReceivedTripsBanner";
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

  it("over the dashboard map it floats in the chrome band, not behind the globe (UAT 2026-11-27, M1)", async () => {
    api.receivedTrips.mockResolvedValue({
      count: 1,
      items: [
        {
          kind: "offer",
          id: "o1",
          tripId: null,
          tripName: "Island",
          from: { displayName: "Ben", origin: "https://b.example" },
          autoAccepted: false,
        },
      ],
    });
    render(
      <MemoryRouter>
        <ReceivedTripsBanner overMap />
      </MemoryRouter>
    );
    const banner = await screen.findByTestId("received-trips-banner");
    expect(banner.style.position).toBe("absolute");
    expect(Number(banner.style.zIndex)).toBe(OVER_MAP_Z);
  });

  it("names the sender by name and host, never as name@https://… (UAT 2026-11-27)", async () => {
    api.receivedTrips.mockResolvedValue({
      count: 1,
      items: [
        {
          kind: "offer",
          id: "o1",
          tripId: null,
          tripName: "Island",
          from: { displayName: "dennis", origin: "http://192.0.2.7:3010" },
          autoAccepted: false,
        },
      ],
    });
    render(
      <MemoryRouter>
        <ReceivedTripsBanner />
      </MemoryRouter>
    );
    const banner = await screen.findByTestId("received-trips-banner");
    expect(banner.textContent).not.toContain("http://");
  });
});
