import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { authApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  authApi: {
    forceChangePassword: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import ForceChangePasswordPage from "../pages/ForceChangePasswordPage";

describe("ForceChangePasswordPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders password change form when changeToken is in state", () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/change-password", state: { changeToken: "test-token" } }]}
      >
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText(/auth:forceChangePassword\.newPassword/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth:forceChangePassword\.confirmPassword/i)).toBeInTheDocument();
  });

  it("redirects to login when no changeToken in state", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/change-password", state: null }]}>
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("shows error when passwords don't match", async () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/change-password", state: { changeToken: "test-token" } }]}
      >
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.newPassword/i), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.confirmPassword/i), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:forceChangePassword\.submit/i }));
    expect(
      await screen.findByText(/auth:forceChangePassword\.passwordsNotMatch/i)
    ).toBeInTheDocument();
  });

  it("calls forceChangePassword and navigates to login on success", async () => {
    vi.mocked(authApi.forceChangePassword).mockResolvedValue({ message: "ok" });
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/change-password", state: { changeToken: "test-change-tok" } },
        ]}
      >
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.newPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.confirmPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:forceChangePassword\.submit/i }));
    await waitFor(() =>
      expect(authApi.forceChangePassword).toHaveBeenCalledWith("test-change-tok", "newpassword1")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login", expect.any(Object)));
  });
});
