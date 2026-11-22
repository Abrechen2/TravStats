import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DemoAccountNotice, DEMO_ACCOUNT_TARGET } from "../DemoAccountNotice";
import { useAuthStore } from "../../store/authStore";
import { useDemoAccountStore } from "../../store/demoAccountStore";

const admin = vi.hoisted(() => ({ getSystemInfo: vi.fn() }));
vi.mock("../../lib/api", () => ({ adminApi: admin }));

const setUser = (isAdmin: boolean) =>
  useAuthStore.setState({ user: { id: "u", username: "a", isAdmin } as never });
const renderChip = (variant: "chip" | "menu" = "chip") =>
  render(
    <MemoryRouter>
      <DemoAccountNotice variant={variant} />
    </MemoryRouter>
  );

describe("DemoAccountNotice (the admin-only demo account warning)", () => {
  beforeEach(() => {
    admin.getSystemInfo.mockReset();
    useDemoAccountStore.getState().reset();
  });
  afterEach(cleanup);

  it("shows to an admin when an active demo account exists, linking to Wartung", async () => {
    setUser(true);
    admin.getSystemInfo.mockResolvedValue({ demoUserExists: true, demoUserActive: true });
    renderChip();
    const link = await screen.findByTestId("demo-account-chip");
    expect(link.getAttribute("href")).toBe(DEMO_ACCOUNT_TARGET);
    expect(link.getAttribute("href")).toBe("/settings/wartung#system");
  });

  it("is hidden when no demo account exists, or it is deactivated", async () => {
    setUser(true);
    admin.getSystemInfo.mockResolvedValue({ demoUserExists: false, demoUserActive: false });
    renderChip();
    await waitFor(() => expect(admin.getSystemInfo).toHaveBeenCalled());
    expect(screen.queryByTestId("demo-account-chip")).toBeNull();
    cleanup();
    admin.getSystemInfo.mockResolvedValue({ demoUserExists: true, demoUserActive: false });
    renderChip();
    await waitFor(() => expect(admin.getSystemInfo).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("demo-account-chip")).toBeNull();
  });

  it("is never shown to a non-admin and never asks the admin endpoint", () => {
    setUser(false);
    useDemoAccountStore.setState({ active: true });
    renderChip();
    expect(screen.queryByTestId("demo-account-chip")).toBeNull();
    expect(admin.getSystemInfo).not.toHaveBeenCalled();
  });

  it("the menu variant reads the shared state and spells the full warning", () => {
    setUser(true);
    useDemoAccountStore.setState({ active: true });
    renderChip("menu");
    expect(screen.getByTestId("demo-account-menu").textContent).toBe("common:demoAccount.label");
  });
});
