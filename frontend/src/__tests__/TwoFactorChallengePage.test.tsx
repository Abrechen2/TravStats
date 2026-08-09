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
