import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { authApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  authApi: {
    resetPassword: vi.fn(),
  },
}));

// Mock the custom useTranslation hook to avoid async state updates from
// the settings-store-backed language sync effect
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

// Mock framer-motion to avoid animation-triggered state updates outside act()
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams("token=testtoken123")],
  };
});

import ResetPasswordPage from "../pages/ResetPasswordPage";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form with new password and confirm fields", () => {
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    expect(screen.getByLabelText(/auth:resetPassword\.newPassword/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i)).toBeInTheDocument();
  });

  it("shows error when passwords don't match", async () => {
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.newPassword/i), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:resetPassword\.submit/i }));
    expect(await screen.findByText(/auth:resetPassword\.passwordsNotMatch/i)).toBeInTheDocument();
  });

  it("calls resetPassword and navigates to login on success", async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: "ok" });
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.newPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:resetPassword\.submit/i }));
    await waitFor(() =>
      expect(authApi.resetPassword).toHaveBeenCalledWith("testtoken123", "newpassword1")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login", expect.any(Object)), {
      timeout: 3000,
    });
  }, 10000);
});
