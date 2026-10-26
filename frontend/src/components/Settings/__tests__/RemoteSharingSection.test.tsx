import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";

import RemoteSharingSection from "../RemoteSharingSection";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";

/**
 * "Mitreisende auf anderen Servern" (spec 2026-10-20, F-S4b): nothing is drawn while the server
 * has the feature off; a new code is shown once; people are listed with their server; and every
 * refusal of a claim is its own sentence — naming the other server where it matters.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: {
    status: vi.fn(),
    listInvites: vi.fn(),
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    claim: vi.fn(),
    listPeople: vi.fn(),
    listOffers: vi.fn(),
    acceptOffer: vi.fn(),
    declineOffer: vi.fn(),
    withdrawPerson: vi.fn(),
  },
}));

const api = vi.mocked(sharingRemoteApi);
const OTHER = "https://far.example.org";
const CODE = `${OTHER}#trip:${"ab".repeat(32)}`;

function refusal(status: number, code: string, origin?: string): AxiosError {
  const error = new AxiosError("refused");
  error.response = {
    status,
    data: { error: "English prose the user must never see", code, ...(origin ? { origin } : {}) },
    statusText: "",
    headers: {},
    config: { headers: {} } as never,
  };
  return error;
}

async function claimWith(code: string) {
  await userEvent.type(await screen.findByLabelText("sharing:remote.claim.label"), code);
  await userEvent.click(screen.getByRole("button", { name: "sharing:remote.claim.submit" }));
}

describe("RemoteSharingSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.status.mockResolvedValue({
      available: true,
      reason: null,
      origin: "https://me.example",
      peerAdmitted: true,
    });
    api.listInvites.mockResolvedValue([]);
    api.listPeople.mockResolvedValue([]);
    api.listOffers.mockResolvedValue([]);
  });

  it("draws nothing while the server has the feature off", async () => {
    api.status.mockResolvedValue({
      available: false,
      reason: "switch-off",
      origin: null,
      peerAdmitted: true,
    });
    const { container } = render(<RemoteSharingSection />);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(api.listPeople).not.toHaveBeenCalled();
  });

  it("says so when it cannot even ask, instead of drawing nothing", async () => {
    api.status.mockRejectedValue(new Error("down"));
    render(<RemoteSharingSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:remote.errors.loadFailed");
  });

  it("shows a new code once, with its expiry, and lists it as open", async () => {
    api.createInvite.mockResolvedValue({
      id: "i1",
      code: CODE,
      createdAt: "2026-10-20T10:00:00.000Z",
      expiresAt: "2026-10-23T10:00:00.000Z",
      tripId: null,
    });
    render(<RemoteSharingSection />);
    api.listInvites.mockResolvedValue([
      {
        id: "i1",
        createdAt: "2026-10-20T10:00:00.000Z",
        expiresAt: "2026-10-23T10:00:00.000Z",
        tripId: null,
      },
    ]);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.invites.create" })
    );
    expect(await screen.findByDisplayValue(CODE)).toBeInTheDocument();
    expect(await screen.findByText(/sharing:remote.invites.open/)).toBeInTheDocument();
  });

  it("lists people with their server", async () => {
    api.listPeople.mockResolvedValue([
      {
        id: "p1",
        origin: OTHER,
        username: "ben",
        displayName: "Ben",
        consent: "accepted",
        createdAt: "2026-10-20T10:00:00.000Z",
      },
    ]);
    render(<RemoteSharingSection />);
    expect(await screen.findByText(new RegExp(`"origin":"${OTHER}"`))).toBeInTheDocument();
  });

  it.each([
    ["SHARE_REMOTE_PEER_NOT_ADMITTED", 403, "notAdmitted", OTHER],
    ["SHARE_REMOTE_INVITE_EXPIRED", 400, "expired", undefined],
    ["SHARE_REMOTE_INVITE_USED", 400, "used", undefined],
    ["SHARE_REMOTE_INVITE_WRONG_TAG", 400, "wrongTag", undefined],
    ["SHARE_REMOTE_UNREACHABLE", 502, "unreachable", OTHER],
    ["SHARE_REMOTE_PEER_DISABLED", 409, "peerDisabled", OTHER],
    ["SHARE_REMOTE_PEER_OUTDATED", 409, "outdated", OTHER],
    ["SHARE_REMOTE_INVITE_INVALID", 400, "inviteInvalid", undefined],
  ])("says %s as its own sentence", async (code, status, key, origin) => {
    api.claim.mockRejectedValue(refusal(status, code, origin));
    render(<RemoteSharingSection />);
    await claimWith(CODE);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`sharing:remote.errors.${key}`);
    if (origin) expect(alert).toHaveTextContent(origin);
    expect(alert).not.toHaveTextContent("English prose");
  });

  it("confirms a redeemed code with the person and their server", async () => {
    api.claim.mockResolvedValue({
      id: "p1",
      origin: OTHER,
      username: "anna",
      displayName: "Anna",
      consent: "accepted",
      createdAt: "2026-10-20T10:00:00.000Z",
    });
    render(<RemoteSharingSection />);
    await claimWith(` ${CODE} `);
    expect(api.claim).toHaveBeenCalledWith(CODE);
    expect(await screen.findByRole("status")).toHaveTextContent(OTHER);
  });

  it("says a code redeemed before is already connected, not an error", async () => {
    api.claim.mockResolvedValue({
      id: "p1",
      origin: OTHER,
      username: "anna",
      displayName: "Anna",
      consent: "accepted",
      createdAt: "2026-10-20T10:00:00.000Z",
      alreadyConnected: true,
    });
    render(<RemoteSharingSection />);
    await claimWith(CODE);
    expect(await screen.findByRole("status")).toHaveTextContent("sharing:remote.claim.already");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("withdraws a person's consent only on a second click, and says it was done (F-S4e)", async () => {
    const person = {
      id: "p1",
      origin: OTHER,
      username: "ben",
      displayName: "Ben",
      consent: "accepted" as const,
      createdAt: "2026-10-20T10:00:00.000Z",
    };
    api.listPeople.mockResolvedValue([person]);
    api.withdrawPerson.mockResolvedValue({ ...person, consent: "withdrawn" });
    render(<RemoteSharingSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:remote.people.withdraw" })
    );
    expect(api.withdrawPerson).not.toHaveBeenCalled();
    expect(screen.getByText(/sharing:remote.people.withdrawConfirm/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "sharing:remote.people.withdrawYes" })
    );
    expect(api.withdrawPerson).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      /sharing:remote.people.withdrawn .*"Ben".*far.example.org/
    );
  });

  it("says when the lists cannot be loaded although the server answered, and loads them again on retry", async () => {
    api.listPeople.mockRejectedValueOnce(new Error("down"));
    render(<RemoteSharingSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:remote.errors.listsFailed");
    api.listPeople.mockResolvedValue([
      {
        id: "p1",
        origin: OTHER,
        username: "ben",
        displayName: "Ben",
        consent: "accepted",
        createdAt: "2026-10-20T10:00:00.000Z",
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "sharing:remote.errors.retry" }));
    expect(await screen.findByText(/sharing:remote.people.row .*"Ben"/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks the lists as not current when refreshing them after an action fails", async () => {
    api.createInvite.mockResolvedValue({
      id: "i1",
      code: CODE,
      createdAt: "2026-10-20T10:00:00.000Z",
      expiresAt: "2026-10-23T10:00:00.000Z",
      tripId: null,
    });
    render(<RemoteSharingSection />);
    await screen.findByText("sharing:remote.people.none");
    api.listInvites.mockRejectedValueOnce(new Error("down"));
    await userEvent.click(screen.getByRole("button", { name: "sharing:remote.invites.create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:remote.errors.listsFailed");
  });

  it("lists the trip a trip page's invitation offered once its code is redeemed", async () => {
    api.claim.mockResolvedValue({
      id: "p1",
      origin: OTHER,
      username: "anna",
      displayName: "Anna",
      consent: "accepted",
      createdAt: "2026-10-20T10:00:00.000Z",
    });
    render(<RemoteSharingSection />);
    await waitFor(() => expect(api.listOffers).toHaveBeenCalled());
    api.listOffers.mockResolvedValue([
      {
        id: "o1",
        from: { displayName: "Anna", username: "anna", origin: OTHER },
        trip: { name: "Portugal 2030", startDay: null, endDay: null },
        roster: [],
        counts: {
          flights: 1,
          lodgingStays: 0,
          cruises: 0,
          railJourneys: 0,
          busJourneys: 0,
          ferryJourneys: 0,
          rentals: 0,
          stops: 0,
        },
        offeredAt: "2026-10-20T10:00:00.000Z",
      },
    ]);
    await claimWith(CODE);
    expect(
      await screen.findByText(/sharing:remote.offers.row .*Portugal 2030/)
    ).toBeInTheDocument();
  });
});
