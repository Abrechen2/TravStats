import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const verifyTwoFactor = vi.fn();
const navigate = vi.fn();
const setAuth = vi.fn();

vi.mock("../lib/api", () => ({
  authApi: { verifyTwoFactor: (body: unknown) => verifyTwoFactor(body) },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: (state: { setAuth: typeof setAuth }) => unknown) =>
    selector({ setAuth }),
}));

vi.mock("../components/Brand/Logo", () => ({
  LogoLockup: () => <div data-testid="logo" />,
}));

import TwoFactorChallengePage from "../pages/TwoFactorChallengePage";

const renderPage = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <TwoFactorChallengePage />
    </MemoryRouter>
  );

describe("TwoFactorChallengePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the typed code and lands the session", async () => {
    verifyTwoFactor.mockResolvedValue({ user: { id: "u1", username: "dennis" } });
    renderPage();

    fireEvent.change(screen.getByLabelText("auth:twoFactor.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() => expect(verifyTwoFactor).toHaveBeenCalledWith({ code: "123456" }));
    expect(setAuth).toHaveBeenCalledWith({ id: "u1", username: "dennis" });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  // A right code is not always a session. An account that owes a password change
  // never meets the login handler's change branch — the second factor is asked
  // above it — so the server answers the redeemed challenge with the change flow
  // instead, and this page has to follow it. Reading `result.user` here would
  // have called setAuth(undefined) and dropped the user on a blank app (AUD-005).
  it("hands over to the password change when the server asks for one", async () => {
    verifyTwoFactor.mockResolvedValue({ requiresPasswordChange: true });
    renderPage();

    fireEvent.change(screen.getByLabelText("auth:twoFactor.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/change-password", {
        state: { requiresChange: true },
      })
    );
    expect(setAuth).not.toHaveBeenCalled();
  });

  // Switching to the recovery sheet must change the FIELD, not just the label —
  // sending a recovery code in the `code` field would fail the six-digit schema.
  it("sends a recovery code under the recoveryCode key", async () => {
    verifyTwoFactor.mockResolvedValue({ user: { id: "u1", username: "dennis" } });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.useRecovery" }));
    fireEvent.change(screen.getByLabelText("auth:twoFactor.recoveryLabel"), {
      target: { value: "bcdfg-hjkmn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() =>
      expect(verifyTwoFactor).toHaveBeenCalledWith({ recoveryCode: "bcdfg-hjkmn" })
    );
  });

  it("shows a rejection instead of navigating when the code is wrong", async () => {
    verifyTwoFactor.mockRejectedValue(new Error("nope"));
    renderPage();

    fireEvent.change(screen.getByLabelText("auth:twoFactor.codeLabel"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() => expect(screen.getByText("auth:twoFactor.rejected")).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
    expect(setAuth).not.toHaveBeenCalled();
  });
});
