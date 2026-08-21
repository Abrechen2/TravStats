import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";

vi.mock("../lib/api", () => ({
  authApi: {
    login: vi.fn(),
    getSmtpStatus: vi.fn().mockResolvedValue({ smtpEnabled: false, adminContactEmail: null }),
    getRegistrationStatus: vi.fn().mockResolvedValue({
      registrationEnabled: true,
      requiresInvitation: false,
      limitReached: false,
    }),
    forgotPassword: vi.fn(),
  },
  // The page asks on mount whether passkeys are possible. Default to "no" here
  // so these cases keep testing the password form; the passkey button has its
  // own suite.
  passkeyApi: {
    availability: vi.fn().mockResolvedValue({ available: false, reason: "notConfigured" }),
    loginOptions: vi.fn(),
    loginVerify: vi.fn(),
  },
}));
vi.mock("../store/authStore");

const mockNavigate = vi.fn();
const mockUseLocation = vi.fn(() => ({
  pathname: "/login",
  search: "",
  hash: "",
  state: null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockUseLocation(),
  };
});

import LoginPage from "../pages/LoginPage";

const mockUseAuthStore = vi.mocked(useAuthStore);

describe("LoginPage", () => {
  const mockSetAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockUseAuthStore.mockReturnValue({
      setAuth: mockSetAuth,
    } as ReturnType<typeof useAuthStore>);
    mockUseLocation.mockReturnValue({
      pathname: "/login",
      search: "",
      hash: "",
      state: null,
    });
    vi.mocked(authApi.getSmtpStatus).mockResolvedValue({
      smtpEnabled: false,
      adminContactEmail: null,
    });
  });

  it("should render login form", () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    // Labels use i18n keys: login.username, login.password
    expect(screen.getByLabelText(/login\.username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/login\.password/i)).toBeInTheDocument();
    // Submit button text is i18n key: login.submit
    expect(screen.getByRole("button", { name: /login\.submit/i })).toBeInTheDocument();
  });

  it("should show error on failed login", async () => {
    vi.mocked(authApi.login).mockRejectedValue({
      response: { data: { error: "Invalid credentials" } },
    });

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const usernameInput = screen.getByLabelText(/login\.username/i);
    const passwordInput = screen.getByLabelText(/login\.password/i);
    const submitButton = screen.getByRole("button", { name: /login\.submit/i });

    fireEvent.change(usernameInput, { target: { value: "testuser" } });
    fireEvent.change(passwordInput, { target: { value: "wrongpassword" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  it("should navigate to register page", () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    // Register link text is i18n key: login.register
    const registerLink = screen.getByRole("link", { name: /login\.register/i });
    expect(registerLink).toHaveAttribute("href", "/register");
  });

  it("hides the register link when registration is disabled (#258)", async () => {
    vi.mocked(authApi.getRegistrationStatus).mockResolvedValue({
      registrationEnabled: false,
      requiresInvitation: true,
      limitReached: false,
    });

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(authApi.getRegistrationStatus).toHaveBeenCalled();
    });
    expect(screen.queryByRole("link", { name: /login\.register/i })).toBeNull();
  });

  it("shows forgot password link", () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    expect(screen.getByText(/login\.forgotPassword/i)).toBeInTheDocument();
  });

  it("opens forgot password modal when link clicked", async () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    fireEvent.click(screen.getByText(/login\.forgotPassword/i));
    await waitFor(() => {
      expect(screen.getByText(/login\.forgotPasswordModal\.title/i)).toBeInTheDocument();
    });
  });

  it("redirects to /change-password when login returns requiresPasswordChange", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requiresPasswordChange: true as const,
    });
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/login\.username/i), { target: { value: "user" } });
    fireEvent.change(screen.getByLabelText(/login\.password/i), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: /login\.submit/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/change-password", {
        state: { requiresChange: true },
      });
    });
  });
});
