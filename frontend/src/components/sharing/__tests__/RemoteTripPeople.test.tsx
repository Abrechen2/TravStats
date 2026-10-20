import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";

import RemoteTripPeople from "../RemoteTripPeople";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import type { RemoteMember, TripRemoteSharing } from "../../../types/sharingRemote";

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
      stateReason: null,
      stateSince: "2026-10-20T10:00:00.000Z",
      delivery: { state: "delivered", stateSince: null, reason: null, field: null, label: null },
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

  it("lists each member with their server and state, and that everything arrived", async () => {
    render(<RemoteTripPeople tripId="t1" />);
    expect(
      await screen.findByText(/sharing:remote.trip.row .*"Ben".*far.example.org/)
    ).toBeInTheDocument();
    expect(screen.getByText("sharing:remote.trip.state.active")).toBeInTheDocument();
    expect(screen.getByTestId("remote-member-status")).toHaveTextContent(
      /sharing:remote.trip.delivery.delivered .*"Ben"/
    );
  });

  /** One member as the server reports them, everything else as in `view()`. */
  const member = (over: Partial<RemoteMember>): TripRemoteSharing =>
    view({ members: [{ ...view().members[0], ...over }] });
  const since = "2026-10-12T08:00:00.000Z";

  it.each<[string, Partial<RemoteMember>, RegExp]>([
    [
      "on the way",
      { delivery: { state: "pending", stateSince: null, reason: null, field: null, label: null } },
      /sharing:remote.trip.delivery.pending .*"Ben"/,
    ],
    [
      "retried since when, naming the server that does not answer",
      {
        delivery: {
          state: "retrying",
          stateSince: since,
          reason: "unreachable",
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.retrying .*"Ben".*far.example.org.*"date":"[^"]+"/,
    ],
    [
      "unreachable since when",
      {
        state: "unreachable",
        stateReason: "unreachable",
        delivery: {
          state: "unreachable",
          stateSince: since,
          reason: null,
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.unreachable .*"Ben".*"date":"[^"]+"/,
    ],
    [
      "a refused change, the entry and why",
      {
        delivery: {
          state: "rejected",
          stateSince: since,
          reason: "schema",
          field: "changes.0.field",
          label: "TP571 FRA → LIS",
        },
      },
      /sharing:remote.trip.delivery.rejected .*"entry":"TP571 FRA → LIS".*delivery.why.schema/,
    ],
    [
      "too large to send, naming the entry",
      {
        delivery: {
          state: "rejected",
          stateSince: since,
          reason: "too-large",
          field: null,
          label: "TP571 FRA → LIS",
        },
      },
      /sharing:remote.trip.delivery.rejected .*"entry":"TP571 FRA → LIS".*delivery.why.too-large/,
    ],
    [
      "switched off on that server",
      { state: "suspended", stateReason: "off" },
      /sharing:remote.trip.reason.off .*"Ben"/,
    ],
    [
      "blocked by this server's admin",
      { state: "suspended", stateReason: "peer-blocked" },
      /sharing:remote.trip.reason.peer-blocked .*"Ben"/,
    ],
  ])("says when changes are %s, in its own sentence", async (_case, over, sentence) => {
    api.tripSharing.mockResolvedValue(member(over));
    render(<RemoteTripPeople tripId="t1" />);
    expect(await screen.findByTestId("remote-member-status")).toHaveTextContent(sentence);
  });

  it("names an entry too large to send beside the delivery line", async () => {
    api.tripSharing.mockResolvedValue(member({ stateReason: "entries-too-large" }));
    render(<RemoteTripPeople tripId="t1" />);
    await screen.findByText(/sharing:remote.trip.delivery.delivered/);
    expect(screen.getAllByTestId("remote-member-status")[1]).toHaveTextContent(
      /sharing:remote.trip.reason.entries-too-large/
    );
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
