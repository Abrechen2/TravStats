import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  login: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    setupApi: { ...actual.setupApi, getStatus: () => mocks.getStatus() },
    authApi: { ...actual.authApi, login: (u: string, p: string) => mocks.login(u, p) },
  };
});

import SetupPage from "../SetupPage";
import { useAuthStore } from "../../store/authStore";

function renderSetupPage() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null } as Parameters<typeof useAuthStore.setState>[0]);
});

describe("SetupPage — try-the-demo option", () => {
  it("offers nothing when no demo account exists", async () => {
    mocks.getStatus.mockResolvedValue({
      setupComplete: false,
      requiresSetup: true,
      message: "",
      demoAccountAvailable: false,
    });
    renderSetupPage();
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalled());
    expect(screen.queryByText("setup:demo.title")).not.toBeInTheDocument();
  });

  it("offers the demo, signs in with the fixed credentials and lands on the dashboard", async () => {
    mocks.getStatus.mockResolvedValue({
      setupComplete: false,
      requiresSetup: true,
      message: "",
      demoAccountAvailable: true,
    });
    mocks.login.mockResolvedValue({ user: { id: "u1", username: "demo", isAdmin: false } });
    const user = userEvent.setup();

    renderSetupPage();
    const button = await screen.findByRole("button", { name: "setup:demo.cta" });
    await user.click(button);

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("demo", "demo123"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
    expect(useAuthStore.getState().user?.username).toBe("demo");
  });

  it("shows the generic setup error copy when the demo login call fails", async () => {
    mocks.getStatus.mockResolvedValue({
      setupComplete: false,
      requiresSetup: true,
      message: "",
      demoAccountAvailable: true,
    });
    mocks.login.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    renderSetupPage();
    const button = await screen.findByRole("button", { name: "setup:demo.cta" });
    await user.click(button);

    expect(await screen.findByText("setup:demo.error")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
