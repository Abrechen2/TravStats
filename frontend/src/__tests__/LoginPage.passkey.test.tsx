import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  getSmtpStatus: vi.fn().mockResolvedValue({ smtpEnabled: false, adminContactEmail: null }),
  forgotPassword: vi.fn(),
}));
const passkeyApi = vi.hoisted(() => ({
  availability: vi.fn(),
  loginOptions: vi.fn(),
  loginVerify: vi.fn(),
}));
const startAuthentication = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const setAuth = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ authApi, passkeyApi }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication }));
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../store/authStore", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: { setAuth: typeof setAuth }) => unknown) =>
      selector ? selector({ setAuth }) : { setAuth },
    { getState: () => ({ setAuth }) }
  ),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import LoginPage from "../pages/LoginPage";

const renderPage = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );

describe("LoginPage — passkey sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.getSmtpStatus.mockResolvedValue({ smtpEnabled: false, adminContactEmail: null });
  });

  // On an insecure origin WebAuthn cannot run at all, so the button must not
  // exist rather than exist-and-fail.
  it("hides the button when the origin cannot do passkeys", async () => {
    passkeyApi.availability.mockResolvedValue({ available: false, reason: "insecureOrigin" });
    renderPage();

    await waitFor(() => expect(passkeyApi.availability).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "login.passkeySubmit" })).toBeNull();
  });

  it("offers the button when passkeys are available", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "login.passkeySubmit" })).toBeInTheDocument()
    );
  });

  // The beta-UAT scenario: tunnel https CONFIGURED (server says available), but
  // THIS page was reached over plain-http LAN. The browser cannot run WebAuthn
  // there, so the button must not appear no matter what the config says.
  it("hides the button on an insecure page even when the server says available", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    try {
      renderPage();
      await waitFor(() => expect(passkeyApi.availability).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "login.passkeySubmit" })).toBeNull();
    } finally {
      // jsdom keeps isSecureContext on the prototype — when there was no own
      // descriptor, restoring means DELETING our override, not re-defining.
      if (original) Object.defineProperty(window, "isSecureContext", original);
      else delete (window as { isSecureContext?: boolean }).isSecureContext;
    }
  });

  it("signs in without a username or password", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    passkeyApi.loginOptions.mockResolvedValue({ challenge: "c" });
    startAuthentication.mockResolvedValue({ id: "cred-1" });
    passkeyApi.loginVerify.mockResolvedValue({ user: { id: "u1", username: "dennis" } });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "login.passkeySubmit" }));

    await waitFor(() => expect(passkeyApi.loginVerify).toHaveBeenCalledWith({ id: "cred-1" }));
    expect(setAuth).toHaveBeenCalledWith({ id: "u1", username: "dennis" });
    expect(navigate).toHaveBeenCalledWith("/");
    // The password endpoint must not have been touched at all.
    expect(authApi.login).not.toHaveBeenCalled();
  });

  // Cancelling the OS / password-manager sheet is normal and must not paint an
  // error the user did not cause.
  it("stays silent when the user dismisses the passkey dialog", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    passkeyApi.loginOptions.mockResolvedValue({ challenge: "c" });
    startAuthentication.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" })
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "login.passkeySubmit" }));

    await waitFor(() => expect(startAuthentication).toHaveBeenCalled());
    expect(screen.queryByText("login.passkeyFailed")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reports a genuine passkey failure", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    passkeyApi.loginOptions.mockResolvedValue({ challenge: "c" });
    startAuthentication.mockRejectedValue(new Error("boom"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "login.passkeySubmit" }));

    await waitFor(() =>
      expect(screen.getByText("login.passkeyFailed")).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
