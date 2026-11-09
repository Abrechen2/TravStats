import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FriendAcceptPage from "../FriendAcceptPage";
import { comparisonApi } from "../../lib/api/comparison";
import { ALL_ON, VALID_PAYLOAD, b64url } from "../../components/friends/__tests__/fixtures";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  access: "allowed",
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user: state.user }),
}));
vi.mock("../../hooks/useBetaFeatures", () => ({ useBetaFeatureAccess: () => state.access }));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock(
  "../../components/friends/SwitchesAskDialog",
  async () => (await import("../../components/friends/__tests__/fixtures")).switchesDialogStub
);
vi.mock("../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../lib/api/comparison")>()),
  comparisonApi: { redeemInviteLink: vi.fn() },
}));

const PAYLOAD = b64url(VALID_PAYLOAD);
const at = (hash: string) => {
  window.history.replaceState(null, "", `/freunde/annehmen${hash}`);
  return render(
    <MemoryRouter>
      <FriendAcceptPage />
    </MemoryRouter>
  );
};

describe("FriendAcceptPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: "u1" };
    state.access = "allowed";
    vi.mocked(comparisonApi.redeemInviteLink).mockResolvedValue({ status: "awaitingAdmin" });
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("a truncated payload says the link is damaged and calls no API", () => {
    at(`#${PAYLOAD.slice(0, -25)}`);
    expect(screen.getByText("friends.accept.damaged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "friends.accept.button" })).toBeNull();
    expect(comparisonApi.redeemInviteLink).not.toHaveBeenCalled();
  });

  it("a foreign or oversized payload is damaged too", () => {
    at(`#${b64url({ hello: "world" })}`);
    expect(screen.getByText("friends.accept.damaged")).toBeInTheDocument();
  });

  it("redeem is not called on load, and the page shows whose server and which fingerprint", () => {
    at(`#${PAYLOAD}`);
    expect(comparisonApi.redeemInviteLink).not.toHaveBeenCalled();
    expect(screen.getByTestId("accept-origin").textContent).toBe("https://far.example");
    expect(screen.getByTestId("accept-fingerprint").textContent).toBe("bbbb ".repeat(15) + "bbbb");
  });

  it("awaitingAdmin reads 'Wartet auf die Freigabe deines Admins'", async () => {
    at(`#${PAYLOAD}`);
    fireEvent.click(screen.getByRole("button", { name: "friends.accept.button" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    expect((await screen.findByTestId("accept-outcome")).textContent).toBe(
      "friends.outcome.awaitingAdmin"
    );
    expect(comparisonApi.redeemInviteLink).toHaveBeenCalledWith(PAYLOAD, ALL_ON);
  });

  it("the fragment is cleared after redeeming", async () => {
    at(`#${PAYLOAD}`);
    fireEvent.click(screen.getByRole("button", { name: "friends.accept.button" }));
    expect(window.location.hash).toBe(`#${PAYLOAD}`);
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await screen.findByTestId("accept-outcome");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/freunde/annehmen");
  });

  it("a refused redeem keeps the fragment so the reader can try again", async () => {
    vi.mocked(comparisonApi.redeemInviteLink).mockRejectedValue(new Error("refused"));
    at(`#${PAYLOAD}`);
    fireEvent.click(screen.getByRole("button", { name: "friends.accept.button" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.redeemInviteLink).toHaveBeenCalled());
    expect(window.location.hash).toBe(`#${PAYLOAD}`);
    expect(screen.queryByTestId("accept-outcome")).toBeNull();
  });

  it("a signed-out reader is asked to sign in and nothing is sent", () => {
    state.user = null;
    at(`#${PAYLOAD}`);
    expect(screen.getByText("friends.accept.signIn")).toBeInTheDocument();
    expect(comparisonApi.redeemInviteLink).not.toHaveBeenCalled();
  });

  it("says the feature is off on this server instead of redirecting", () => {
    state.access = "denied";
    at(`#${PAYLOAD}`);
    expect(screen.getByText("friends.accept.off")).toBeInTheDocument();
  });
});
