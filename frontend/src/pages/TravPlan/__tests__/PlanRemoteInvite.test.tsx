import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanRemoteInvite } from "../PlanRemoteInvite";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  invite: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts && "defaultValue" in opts ? key : opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { inviteConnections: mocks.list, inviteConnection: mocks.invite },
}));

const option = (over: object = {}) => ({
  connectionId: "c1",
  displayName: "Ben",
  username: "ben",
  origin: "https://far.example.org",
  member: false,
  ...over,
});
const apiError = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });

beforeEach(() => {
  mocks.list.mockReset();
  mocks.invite.mockReset();
});

describe("PlanRemoteInvite", () => {
  it("offers only the connections the server lists, and invites one by its connection", async () => {
    mocks.list.mockResolvedValue([
      option(),
      option({ connectionId: "c2", displayName: "Eva", member: true }),
    ]);
    mocks.invite.mockResolvedValue({});
    const changed = vi.fn();
    render(<PlanRemoteInvite tripId="t1" onChanged={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "remote.invite.send:Ben" }));
    expect(mocks.invite).toHaveBeenCalledWith("t1", "c1");
    expect(await screen.findByText("remote.invite.sent:Ben")).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    // A person already on the plan cannot be picked again.
    expect(screen.getByRole("button", { name: "remote.invite.send:Eva" })).toBeDisabled();
  });

  it("says why an invitation failed when the person's server does not answer", async () => {
    mocks.list.mockResolvedValue([option()]);
    mocks.invite.mockRejectedValue(apiError(502, "SHARE_REMOTE_UNREACHABLE"));
    const changed = vi.fn();
    render(<PlanRemoteInvite tripId="t1" onChanged={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "remote.invite.send:Ben" }));
    expect(
      await screen.findByText("remote.invite.errors.SHARE_REMOTE_UNREACHABLE")
    ).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByText("remote.invite.sent:Ben")).not.toBeInTheDocument();
  });

  it("explains where to switch plans on when no connection qualifies", async () => {
    mocks.list.mockResolvedValue([]);
    render(<PlanRemoteInvite tripId="t1" onChanged={vi.fn()} />);
    expect(await screen.findByText("remote.invite.none")).toBeInTheDocument();
  });

  it("draws nothing while sharing across servers is off, and names a failed load otherwise", async () => {
    mocks.list.mockRejectedValueOnce(apiError(404, "SHARE_REMOTE_DISABLED"));
    const { container, unmount } = render(<PlanRemoteInvite tripId="t1" onChanged={vi.fn()} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    unmount();
    mocks.list.mockRejectedValueOnce(Object.assign(new Error("net"), { response: undefined }));
    render(<PlanRemoteInvite tripId="t1" onChanged={vi.fn()} />);
    expect(await screen.findByText("errors.network")).toBeInTheDocument();
  });
});
