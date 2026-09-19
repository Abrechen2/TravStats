import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  getSmtpStatus: vi.fn().mockResolvedValue({ smtpEnabled: false, adminContactEmail: null }),
  getRegistrationStatus: vi.fn().mockResolvedValue({
    registrationEnabled: true,
    requiresInvitation: false,
    limitReached: false,
  }),
  forgotPassword: vi.fn(),
}));
const passkeyApi = vi.hoisted(() => ({
  availability: vi.fn(),
  loginOptions: vi.fn(),
  loginVerify: vi.fn(),
}));
// The page also asks on mount whether this is a public demo instance.
// Default to "no" so these cases keep testing ordinary passkey sign-in.
const setupApi = vi.hoisted(() => ({
  getStatus: vi.fn().mockResolvedValue({
    setupComplete: true,
    requiresSetup: false,
    message: "",
    publicDemoLogin: false,
  }),
}));
const startAuthentication = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const setAuth = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ authApi, passkeyApi, setupApi }));
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

    await waitFor(() => expect(screen.getByText("login.passkeyFailed")).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * forgejo#88 finding 4, second surface.
   *
   * `authLimiter` sits on `/auth/passkeys/login/options` and `/login/verify`,
   * in the SAME address-keyed bucket as `/auth/login` — so a password manager
   * retrying an assertion, or a shared address behind a reverse proxy, trips
   * the ceiling here just as readily. The branch threw the response away for a
   * fixed "Passkey-Anmeldung fehlgeschlagen", which sends the reader hunting a
   * broken credential instead of waiting a minute.
   */
  it("names the rate limit rather than blaming the passkey", async () => {
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    passkeyApi.loginOptions.mockRejectedValue({
      response: {
        status: 429,
        data: {
          error: "Too many authentication attempts, please try again later",
          code: "RATE_LIMITED",
          retryAfterSeconds: 300,
        },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "login.passkeySubmit" }));

    await waitFor(() =>
      expect(screen.getByText("login.errors.rateLimitedMinutes")).toBeInTheDocument()
    );
    expect(screen.queryByText("login.passkeyFailed")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("still blames nothing but the passkey for a 403, which is two things at once", async () => {
    // `/login/verify` answers 403 both for a deactivated account and for "set a
    // new password first". The screen cannot tell them apart, so it must NOT
    // claim the account is switched off — hence no `deactivated` key in its copy.
    passkeyApi.availability.mockResolvedValue({ available: true, reason: null });
    passkeyApi.loginOptions.mockResolvedValue({ challenge: "c" });
    startAuthentication.mockResolvedValue({ id: "cred" });
    passkeyApi.loginVerify.mockRejectedValue({
      response: { status: 403, data: { error: "Account is deactivated" } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "login.passkeySubmit" }));

    await waitFor(() => expect(screen.getByText("login.passkeyFailed")).toBeInTheDocument());
    expect(screen.queryByText("login.errors.accountDeactivated")).toBeNull();
  });
});
