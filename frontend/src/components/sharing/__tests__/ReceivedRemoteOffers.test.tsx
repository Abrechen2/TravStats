import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AxiosError } from "axios";

import ReceivedRemoteOffers from "../ReceivedRemoteOffers";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import type { ReceivedOffer } from "../../../types/sharingRemote";

/**
 * Trips offered from other servers (spec 2026-10-20 F-S4c): the person decides on their own
 * server, informed of what the trip holds and who is on it; accepting opens the new trip, a
 * decline says nothing was copied, and a failed answer is its own sentence.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: { listOffers: vi.fn(), acceptOffer: vi.fn(), declineOffer: vi.fn() },
}));

const api = vi.mocked(sharingRemoteApi);
const FAR = "https://far.example.org";
const OFFER: ReceivedOffer = {
  id: "o1",
  from: { displayName: "Anna", username: "anna", origin: FAR },
  trip: { name: "Portugal 2030", startDay: "2030-06-01", endDay: "2030-06-10" },
  roster: [{ displayName: "Anna", origin: FAR }],
  counts: {
    flights: 2,
    lodgingStays: 1,
    cruises: 0,
    railJourneys: 0,
    busJourneys: 0,
    ferryJourneys: 0,
    rentals: 0,
    stops: 0,
  },
  offeredAt: "2026-10-20T10:00:00.000Z",
};
const draw = () =>
  render(
    <MemoryRouter>
      <ReceivedRemoteOffers />
    </MemoryRouter>
  );

describe("ReceivedRemoteOffers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listOffers.mockResolvedValue([OFFER]);
  });

  it("draws nothing without an open offer", async () => {
    api.listOffers.mockResolvedValue([]);
    const { container } = draw();
    await waitFor(() => expect(api.listOffers).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("names the trip, its sender's server, what it holds and who is on it", async () => {
    draw();
    expect(
      await screen.findByText(/sharing:remote.offers.row .*Portugal 2030.*far.example.org/)
    ).toBeInTheDocument();
    expect(screen.getByText(/sharing:remote.offers.count.flights .*"count":2/)).toBeInTheDocument();
    expect(screen.getByText(/sharing:remote.offers.roster/)).toBeInTheDocument();
  });

  it("accepting makes it the person's trip and links to it", async () => {
    api.acceptOffer.mockResolvedValue({ tripId: "t-new" });
    draw();
    api.listOffers.mockResolvedValue([]);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.offers.accept" })
    );
    expect(api.acceptOffer).toHaveBeenCalledWith("o1");
    expect(await screen.findByRole("status")).toHaveTextContent(/sharing:remote.offers.accepted/);
    expect(screen.getByRole("link", { name: "sharing:remote.offers.open" })).toHaveAttribute(
      "href",
      "/trips/t-new"
    );
  });

  it("declining says nothing was copied", async () => {
    api.declineOffer.mockResolvedValue();
    draw();
    api.listOffers.mockResolvedValue([]);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.offers.decline" })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("sharing:remote.offers.declined");
  });

  it("an answer the other server did not take is its own sentence, naming that server", async () => {
    const error = new AxiosError("refused");
    error.response = {
      status: 502,
      data: { error: "That server does not answer", code: "SHARE_REMOTE_UNREACHABLE", origin: FAR },
      statusText: "",
      headers: {},
      config: { headers: {} } as never,
    };
    api.acceptOffer.mockRejectedValue(error);
    draw();
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.offers.accept" })
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sharing:remote.errors.unreachable .*far.example.org/);
    expect(screen.getByRole("button", { name: "sharing:remote.offers.accept" })).toBeEnabled();
  });
});
