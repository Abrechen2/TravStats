import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";

import RemoteTripPeople from "../RemoteTripPeople";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import type { TripRemoteSharing } from "../../../types/sharingRemote";

/**
 * The trip's people on other servers (spec 2026-10-20 §7, F-S4c): each with server and state and
 * what last went wrong; an offer to a paired person from here; every refusal its own sentence
 * naming the other server; a trip from another server names it and offers nobody; nothing at all
 * behind the beta key.
 */
const beta = vi.hoisted(() => ({ on: true }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ betaFeaturesEnabled: beta.on, isFeatureVisible: () => beta.on }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: {
    status: vi.fn(),
    tripSharing: vi.fn(),
    offerTrip: vi.fn(),
    createTripInvite: vi.fn(),
  },
}));

const api = vi.mocked(sharingRemoteApi);
const FAR = "https://far.example.org";
const view = (over: Partial<TripRemoteSharing> = {}): TripRemoteSharing => ({
  homeOrigin: null,
  members: [
    {
      id: "m1",
      remoteId: "r1",
      displayName: "Ben",
      username: "ben",
      origin: FAR,
      state: "active",
      stateReason: "entries-undelivered",
      stateSince: "2026-10-20T10:00:00.000Z",
    },
  ],
  offerable: [{ remoteId: "r2", displayName: "Cleo", username: "cleo", origin: FAR }],
  ...over,
});

function refusal(code: string, origin?: string): AxiosError {
  const error = new AxiosError("refused");
  error.response = {
    status: 403,
    data: { error: "English prose the user must never see", code, ...(origin ? { origin } : {}) },
    statusText: "",
    headers: {},
    config: { headers: {} } as never,
  };
  return error;
}

describe("RemoteTripPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beta.on = true;
    api.status.mockResolvedValue({ available: true, reason: null, origin: "https://me.example" });
    api.tripSharing.mockResolvedValue(view());
  });

  it("draws nothing and asks nothing behind the beta key", () => {
    beta.on = false;
    const { container } = render(<RemoteTripPeople tripId="t1" />);
    expect(container).toBeEmptyDOMElement();
    expect(api.status).not.toHaveBeenCalled();
  });

  it("draws nothing while the server has the feature off", async () => {
    api.status.mockResolvedValue({ available: false, reason: "switch-off", origin: null });
    const { container } = render(<RemoteTripPeople tripId="t1" />);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(api.tripSharing).not.toHaveBeenCalled();
  });

  it("lists each member with their server and state, and says what did not arrive", async () => {
    render(<RemoteTripPeople tripId="t1" />);
    expect(
      await screen.findByText(/sharing:remote.trip.row .*"Ben".*far.example.org/)
    ).toBeInTheDocument();
    expect(screen.getByText("sharing:remote.trip.state.active")).toBeInTheDocument();
    expect(screen.getByText(/sharing:remote.trip.reason.entries-undelivered/)).toBeInTheDocument();
  });

  it("offers the trip to a paired person, and says who decides where", async () => {
    api.offerTrip.mockResolvedValue({
      ...view().members[0],
      id: "m2",
      remoteId: "r2",
      state: "invited",
    });
    render(<RemoteTripPeople tripId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "sharing:remote.trip.offer" }));
    expect(api.offerTrip).toHaveBeenCalledWith("t1", "r2");
    expect(await screen.findByRole("status")).toHaveTextContent(
      /sharing:remote.trip.offered .*Cleo/
    );
  });

  it("names the server the admin has not admitted, never the server's English", async () => {
    api.offerTrip.mockRejectedValue(refusal("SHARE_REMOTE_PEER_NOT_ADMITTED", FAR));
    render(<RemoteTripPeople tripId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "sharing:remote.trip.offer" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sharing:remote.errors.notAdmitted .*far.example.org/);
    expect(alert).not.toHaveTextContent("English prose");
  });

  it("a trip from another server names it and offers nobody", async () => {
    api.tripSharing.mockResolvedValue(view({ homeOrigin: FAR, offerable: [] }));
    render(<RemoteTripPeople tripId="t1" />);
    expect(
      await screen.findByText(/sharing:remote.trip.fromServer .*far.example.org/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when the trip's people on other servers cannot be loaded", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    render(<RemoteTripPeople tripId="t1" standalone />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sharing:remote.trip.errors.loadFailed"
    );
  });
});
