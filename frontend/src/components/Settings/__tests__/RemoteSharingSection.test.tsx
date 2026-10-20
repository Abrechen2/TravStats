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
    api.status.mockResolvedValue({ available: true, reason: null, origin: "https://me.example" });
    api.listInvites.mockResolvedValue([]);
    api.listPeople.mockResolvedValue([]);
  });

  it("draws nothing while the server has the feature off", async () => {
    api.status.mockResolvedValue({ available: false, reason: "switch-off", origin: null });
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
    });
    render(<RemoteSharingSection />);
    api.listInvites.mockResolvedValue([
      { id: "i1", createdAt: "2026-10-20T10:00:00.000Z", expiresAt: "2026-10-23T10:00:00.000Z" },
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
});
