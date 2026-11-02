import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RemotePlanInvitations from "../RemotePlanInvitations";
import { remotePlansApi, type RemotePlanSummary } from "../../../lib/api/remotePlans";

// One function for every render, as the real hook's `t` is: a new one each time would reload.
const t = vi.hoisted(
  () => (key: string, params?: Record<string, string>) =>
    params && !("defaultValue" in params) ? `${key} ${JSON.stringify(params)}` : key
);
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../../../lib/api/remotePlans", () => ({
  remotePlansApi: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
}));
const api = vi.mocked(remotePlansApi);

const invite = (over: Partial<RemotePlanSummary> = {}): RemotePlanSummary => ({
  connectionId: "c1",
  origin: "https://far.example.org",
  planId: "p1",
  tripId: "t1",
  title: "Madeira",
  ownerDisplayName: "Ben",
  role: "editor",
  state: "invited",
  ...over,
});
const failure = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });

beforeEach(() => vi.clearAllMocks());

describe("RemotePlanInvitations", () => {
  it("lists only invitations and removes one once the host took the answer", async () => {
    api.list.mockResolvedValue([invite(), invite({ planId: "p2", state: "active" })]);
    api.accept.mockResolvedValue(invite({ state: "active" }));
    const changed = vi.fn();
    render(<RemotePlanInvitations onChange={changed} />);
    expect(await screen.findAllByText(/travplan:remote.invitation /)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "travplan:members.accept" }));
    expect(api.accept).toHaveBeenCalledWith(expect.objectContaining({ planId: "p1" }));
    await waitFor(() =>
      expect(screen.queryByText(/travplan:remote.invitation /)).not.toBeInTheDocument()
    );
    expect(changed).toHaveBeenCalled();
  });

  it("keeps the invitation and says why when the host does not answer", async () => {
    api.list.mockResolvedValue([invite()]);
    api.accept.mockRejectedValue(failure(503, "REMOTE_PLAN_UNREACHABLE"));
    const changed = vi.fn();
    render(<RemotePlanInvitations onChange={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "travplan:members.accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "travplan:errors.REMOTE_PLAN_UNREACHABLE"
    );
    expect(screen.getByText(/travplan:remote.invitation /)).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it("draws nothing without invitations and while sharing across servers is off, and names a failed load", async () => {
    api.list.mockResolvedValueOnce([]);
    let empty!: ReturnType<typeof render>;
    await act(async () => {
      empty = render(<RemotePlanInvitations />);
    });
    expect(api.list).toHaveBeenCalled();
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();
    api.list.mockRejectedValueOnce(failure(404, "SHARE_REMOTE_DISABLED"));
    let off!: ReturnType<typeof render>;
    await act(async () => {
      off = render(<RemotePlanInvitations />);
    });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    api.list.mockRejectedValueOnce(failure(500, "X"));
    render(<RemotePlanInvitations />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "travplan:remote.invitations.loadFailed"
    );
  });
});
