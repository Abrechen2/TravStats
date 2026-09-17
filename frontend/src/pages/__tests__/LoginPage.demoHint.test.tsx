import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getStatus = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    setupApi: { getStatus: () => getStatus() },
    passkeyApi: { availability: () => Promise.resolve({ available: false }) },
    authApi: {
      ...actual.authApi,
      getSmtpStatus: () => Promise.resolve({ smtpEnabled: false, adminContactEmail: null }),
      getRegistrationStatus: () => Promise.resolve({ registrationEnabled: true }),
    },
  };
});

import LoginPage from "../LoginPage";

describe("LoginPage — public demo login hint", () => {
  beforeEach(() => getStatus.mockReset());

  it("says nothing about a demo account unless the instance opts in", async () => {
    getStatus.mockResolvedValue({
      setupComplete: true,
      requiresSetup: false,
      message: "",
      publicDemoLogin: false,
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(screen.queryByText("login.demoHint")).toBeNull();
  });

  it("shows the hint and fills both fields on a public demo instance", async () => {
    getStatus.mockResolvedValue({
      setupComplete: true,
      requiresSetup: false,
      message: "",
      publicDemoLogin: true,
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: "login.demoFill" }));
    expect(screen.getByLabelText("login.username")).toHaveValue("demo");
    expect(screen.getByLabelText("login.password")).toHaveValue("demo123");
  });
});
