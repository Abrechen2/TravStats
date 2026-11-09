import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddFriendDialog from "../AddFriendDialog";
import { comparisonApi } from "../../../lib/api/comparison";
import { friendsApi } from "../../../lib/api/friends";
import { ALL_ON, SCOPE, VALID_PAYLOAD, b64url } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock(
  "../../comparison/ConsentDialog",
  async () => (await import("./fixtures")).consentDialogStub
);
vi.mock("../SwitchesAskDialog", async () => (await import("./fixtures")).switchesDialogStub);
vi.mock("../../../lib/api/friends", async (original) => ({
  ...(await original<typeof import("../../../lib/api/friends")>()),
  friendsApi: { request: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: {
    request: vi.fn().mockResolvedValue({}),
    claimInvite: vi.fn().mockResolvedValue({}),
    createInviteLink: vi
      .fn()
      .mockResolvedValue({ url: "https://me.example/freunde/einladung#abc", expiresAt: "t" }),
    redeemInviteLink: vi.fn().mockResolvedValue({ status: "awaitingPeerAdmin" }),
  },
}));

const open = (onChanged = vi.fn()) =>
  render(<AddFriendDialog open onClose={vi.fn()} onChanged={onChanged} />);
const LINK = `https://far.example/freunde/einladung#${b64url(VALID_PAYLOAD)}`;

describe("AddFriendDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("asks a person on this server by username with the chosen switches, not a leaderboard scope", async () => {
    const onChanged = vi.fn();
    open(onChanged);
    fireEvent.change(screen.getByLabelText("add.username"), { target: { value: "ben" } });
    fireEvent.click(screen.getByRole("button", { name: "add.ask" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(friendsApi.request).toHaveBeenCalledWith("ben", null, ALL_ON));
    expect(comparisonApi.request).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks a person on another server when an origin is given", async () => {
    open();
    fireEvent.change(screen.getByLabelText("add.username"), { target: { value: "lena" } });
    fireEvent.change(screen.getByLabelText("friend.add.origin"), {
      target: { value: "https://far.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "add.ask" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() =>
      expect(friendsApi.request).toHaveBeenCalledWith("lena", "https://far.example", ALL_ON)
    );
  });

  it("the link carries the inviter's switches and the redeemed outcome 'awaitingInviter' is named", async () => {
    vi.mocked(comparisonApi.redeemInviteLink).mockResolvedValueOnce({ status: "awaitingInviter" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "friends.makeLink" }));
    await screen.findByDisplayValue("https://me.example/freunde/einladung#abc");
    expect(comparisonApi.createInviteLink).toHaveBeenCalledWith(ALL_ON);
    fireEvent.change(screen.getByLabelText("friends.pasteLabel"), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "friends.redeem" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    expect((await screen.findByTestId("add-outcome")).textContent).toBe(
      "friends.outcome.awaitingInviter"
    );
  });

  it("makes an invitation link to pass on and says so when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: "friends.makeLink" }));
    expect(
      await screen.findByDisplayValue("https://me.example/freunde/einladung#abc")
    ).toBeInTheDocument();
    expect(Object.values(window.localStorage).some((v) => String(v).includes("einladung"))).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "add.copy" }));
    expect((await screen.findByRole("status")).textContent).toBe("add.copyFailed");
  });

  it("redeems a pasted link with the redeemer's switches and names the outcome", async () => {
    open();
    fireEvent.change(screen.getByLabelText("friends.pasteLabel"), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "friends.redeem" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() =>
      expect(comparisonApi.redeemInviteLink).toHaveBeenCalledWith(b64url(VALID_PAYLOAD), ALL_ON)
    );
    expect((await screen.findByTestId("add-outcome")).textContent).toBe(
      "friends.outcome.awaitingPeerAdmin"
    );
  });

  it("a truncated link is called damaged and nothing is sent", () => {
    open();
    fireEvent.change(screen.getByLabelText("friends.pasteLabel"), {
      target: { value: LINK.slice(0, -30) },
    });
    expect(screen.getByText("friends.linkDamaged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "friends.redeem" })).toBeDisabled();
    expect(comparisonApi.redeemInviteLink).not.toHaveBeenCalled();
  });

  it("still redeems a plain code from another server", async () => {
    open();
    const code = "https://far.example#" + "b".repeat(64);
    fireEvent.change(screen.getByLabelText("friends.pasteLabel"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "friends.redeem" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.claimInvite).toHaveBeenCalledWith(code, SCOPE));
  });
});
