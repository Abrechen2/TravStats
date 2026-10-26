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
    decideRosterPerson: vi.fn(),
    reconfirm: vi.fn(),
    dismissParked: vi.fn(),
    requestAddition: vi.fn(),
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
  roster: [],
  reconfirmable: false,
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
    api.status.mockResolvedValue({
      available: true,
      reason: null,
      origin: "https://me.example",
      peerAdmitted: true,
    });
    api.tripSharing.mockResolvedValue(view());
  });

  it("draws nothing and asks nothing behind the beta key", () => {
    beta.on = false;
    const { container } = render(<RemoteTripPeople tripId="t1" />);
    expect(container).toBeEmptyDOMElement();
    expect(api.status).not.toHaveBeenCalled();
  });

  it("draws nothing while the server has the feature off", async () => {
    api.status.mockResolvedValue({
      available: false,
      reason: "switch-off",
      origin: null,
      peerAdmitted: true,
    });
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
      "an error of this server, not the other one's silence",
      {
        delivery: {
          state: "retrying",
          stateSince: since,
          reason: "local-error",
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.retryingLocal .*"Ben"/,
    ],
    [
      "an error the other server met applying it",
      {
        delivery: {
          state: "retrying",
          stateSince: since,
          reason: "remote-error",
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.retryingRemote .*"Ben".*far.example.org/,
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
      "a catch-up the other server does not know yet, as its own sentence, not a refusal",
      {
        delivery: {
          state: "rejected",
          stateSince: since,
          reason: "unsupported",
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.unsupported /,
    ],
    [
      "held on their server until the person there confirms again",
      {
        delivery: {
          state: "retrying",
          stateSince: since,
          reason: "suspended-there",
          field: null,
          label: null,
        },
      },
      /sharing:remote.trip.delivery.retryingHeld .*"Ben".*far.example.org/,
    ],
    [
      "held after the other server's key changed",
      { state: "suspended", stateReason: "repinned" },
      /sharing:remote.trip.reason.repinned .*"Ben"/,
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

  it.each(["entries-too-large", "entries-unattributed"])(
    "names entries that did not travel (%s) beside the delivery line",
    async (reason) => {
      api.tripSharing.mockResolvedValue(member({ stateReason: reason }));
      render(<RemoteTripPeople tripId="t1" />);
      await screen.findByText(/sharing:remote.trip.delivery.delivered/);
      expect(screen.getAllByTestId("remote-member-status")[1]).toHaveTextContent(
        new RegExp(`sharing:remote.trip.reason.${reason}`)
      );
    }
  );

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

  it("a trip from another server names it, offers nobody, and asks its home instead", async () => {
    api.tripSharing.mockResolvedValue(view({ homeOrigin: FAR, offerable: [] }));
    api.requestAddition.mockResolvedValue({ requested: true, origin: FAR });
    render(<RemoteTripPeople tripId="t1" />);
    expect(
      await screen.findByText(/sharing:remote.trip.fromServer .*far.example.org/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "sharing:remote.trip.offer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "sharing:remote.trip.createCode" })).toBeNull();
    const send = screen.getByRole("button", { name: "sharing:remote.trip.addRequest.submit" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText("sharing:remote.trip.addRequest.name"), "Bea");
    await userEvent.type(screen.getByLabelText("sharing:remote.trip.addRequest.note"), "Hi");
    await userEvent.click(send);
    expect(api.requestAddition).toHaveBeenCalledWith("t1", { displayName: "Bea", note: "Hi" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /sharing:remote.trip.addRequest.sent .*"Bea".*far.example.org/
    );
  });

  it("a refused request names its reason in its own sentence", async () => {
    api.tripSharing.mockResolvedValue(view({ homeOrigin: FAR, offerable: [] }));
    api.requestAddition.mockRejectedValue(refusal("SHARE_REMOTE_NOT_MEMBER"));
    render(<RemoteTripPeople tripId="t1" />);
    await userEvent.type(
      await screen.findByLabelText("sharing:remote.trip.addRequest.name"),
      "Bea"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "sharing:remote.trip.addRequest.submit" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:remote.errors.notMember");
  });

  it("asks about a newcomer on the roster and sends the answer", async () => {
    const cleo = {
      ref: "11111111-2222-4333-8444-555555555555",
      displayName: "Cleo",
      origin: "https://c.example.org",
      relation: "pending" as const,
    };
    api.tripSharing.mockResolvedValue(
      view({
        roster: [
          {
            ref: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            displayName: "Ben",
            origin: FAR,
            relation: "paired",
          },
          cleo,
        ],
      })
    );
    api.decideRosterPerson.mockResolvedValue(view());
    render(<RemoteTripPeople tripId="t1" />);
    const statuses = await screen.findAllByTestId("remote-roster-status");
    expect(statuses[1]).toHaveTextContent(/roster.sentence.pending .*"Cleo"/);
    await userEvent.click(
      screen.getByRole("button", { name: "sharing:remote.trip.roster.accept" })
    );
    expect(api.decideRosterPerson).toHaveBeenCalledWith("t1", cleo.ref, "accepted");
  });

  it("offers to confirm held memberships again", async () => {
    api.tripSharing.mockResolvedValue(
      view({
        reconfirmable: true,
        members: [{ ...view().members[0], state: "suspended", stateReason: "restore" }],
      })
    );
    api.reconfirm.mockResolvedValue(view());
    render(<RemoteTripPeople tripId="t1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.trip.reconfirm" })
    );
    expect(api.reconfirm).toHaveBeenCalledWith("t1");
    expect(await screen.findByRole("status")).toHaveTextContent("sharing:remote.trip.reconfirmed");
  });

  it("dismisses a refused change", async () => {
    api.tripSharing.mockResolvedValue(
      member({
        delivery: {
          state: "rejected",
          stateSince: since,
          reason: "schema",
          field: "x",
          label: "TP571",
        },
      })
    );
    api.dismissParked.mockResolvedValue(view());
    render(<RemoteTripPeople tripId="t1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.trip.dismiss" })
    );
    expect(api.dismissParked).toHaveBeenCalledWith("t1", "m1");
  });

  it("says so when the trip's people on other servers cannot be loaded", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    render(<RemoteTripPeople tripId="t1" standalone />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sharing:remote.trip.errors.loadFailed"
    );
  });
});
