import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";

vi.mock("../lib/api");
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
});
