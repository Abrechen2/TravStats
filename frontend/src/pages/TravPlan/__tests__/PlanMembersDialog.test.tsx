import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanMembersDialog } from "../PlanMembersDialog";
import type { PlanCollab } from "../../../lib/api/travplan";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  remove: vi.fn(),
  leave: vi.fn(),
  share: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: {
    invite: mocks.invite,
    removeMember: mocks.remove,
    leave: mocks.leave,
    shareWithMember: mocks.share,
  },
}));

const member = (over: object) => ({
  id: "m",
  kind: "local",
  displayName: "Anna",
  username: "anna",
  role: "editor",
  status: "active",
  createdAt: "2026-11-02T10:00:00.000Z",
  decidedAt: null,
  shared: false,
  ...over,
});
const collab = (isOwner: boolean): PlanCollab =>
  ({
    self: { memberId: "me", kind: isOwner ? "owner" : "local", isOwner },
    members: [member({ id: "me", kind: "owner", displayName: "Papa", role: "owner" }), member({})],
    notices: [],
  }) as PlanCollab;

beforeEach(() => {
  for (const m of [mocks.invite, mocks.remove, mocks.leave, mocks.share]) m.mockReset();
});

describe("PlanMembersDialog", () => {
  it("says whose consent is missing when an invitation is refused", async () => {
    mocks.invite.mockRejectedValueOnce({
      response: { status: 403, data: { code: "PLAN_MEMBER_CONSENT_THEIRS" } },
    });
    render(
      <PlanMembersDialog
        tripId="t"
        collab={collab(true)}
        onClose={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        onLeft={vi.fn()}
      />
    );
    await userEvent.type(screen.getByLabelText("members.username"), "berta");
    await userEvent.click(screen.getByRole("button", { name: "members.invite" }));
    expect(await screen.findByText("errors.PLAN_MEMBER_CONSENT_THEIRS")).toBeInTheDocument();
  });

  it("offers a co-planner to leave, and neither to invite nor to remove anybody", async () => {
    mocks.leave.mockResolvedValueOnce({ left: true });
    const onLeft = vi.fn();
    render(
      <PlanMembersDialog
        tripId="t"
        collab={collab(false)}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onLeft={onLeft}
      />
    );
    expect(screen.queryByRole("button", { name: "members.invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "members.remove" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "members.leave" }));
    expect(onLeft).toHaveBeenCalled();
  });

  it("reports a linked copy that could not be made instead of calling it shared", async () => {
    mocks.share.mockResolvedValueOnce({ memberId: "m", ok: false, code: "SHARE_USER_NOT_FOUND" });
    render(
      <PlanMembersDialog
        tripId="t"
        collab={collab(true)}
        onClose={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        onLeft={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "members.shareNow" }));
    expect(await screen.findByText("errors.SHARE_USER_NOT_FOUND")).toBeInTheDocument();
  });
});
