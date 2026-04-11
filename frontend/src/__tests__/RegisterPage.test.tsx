import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import RegisterPage from "../pages/RegisterPage";
import { useAuthStore } from "../store/authStore";

vi.mock("../lib/api");
vi.mock("../store/authStore");

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

const mockUseAuthStore = vi.mocked(useAuthStore);

describe("RegisterPage", () => {
  const mockSetAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({
      setAuth: mockSetAuth,
    } as ReturnType<typeof useAuthStore>);
  });

  it("should render registration form", () => {
    render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    // Labels use i18n keys: register.username, register.password, register.confirmPassword
    expect(screen.getByLabelText(/register\.username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/register\.password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/register\.confirmPassword/i)).toBeInTheDocument();
  });

  it("should validate password mismatch", async () => {
    const { container } = render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    const passwordInput = screen.getByLabelText(/register\.password$/i);
    const confirmPasswordInput = screen.getByLabelText(/register\.confirmPassword/i);
    const form = container.querySelector("form");

    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "password456" } });

    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(
      () => {
        // Error text is the i18n key: register.passwordsNotMatch
        expect(screen.getByText(/register\.passwordsNotMatch/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("should validate minimum password length", async () => {
    const { container } = render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    const passwordInput = screen.getByLabelText(/register\.password$/i);
    const confirmPasswordInput = screen.getByLabelText(/register\.confirmPassword/i);
    const form = container.querySelector("form");

    fireEvent.change(passwordInput, { target: { value: "12345" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "12345" } });

    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(
      () => {
        // Error text is the i18n key: register.passwordTooShort
        expect(screen.getByText(/register\.passwordTooShort/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
