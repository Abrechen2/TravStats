import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const { config, setConfig } = vi.hoisted(() => ({ config: vi.fn(), setConfig: vi.fn() }));
vi.mock("../../../lib/api/travplan", async (original) => ({
  ...(await original<typeof import("../../../lib/api/travplan")>()),
  travplanApi: { config, setConfig, capabilities: vi.fn() },
}));

import TravPlanSettings from "../TravPlanSettings";

/**
 * Admin → Instanz → TravPlan (owner, 2026-10-26): TravPlan's server switch in
 * the settings, as TravTrack has one. It saves `{enabled}` alone, so the daily
 * limits kept on `/plan/admin` are never overwritten from here.
 */
const LOADED = { enabled: false, aiDailyLimit: 7, weatherDailyLimit: 15 };

const renderSettings = () =>
  render(
    <MemoryRouter>
      <TravPlanSettings />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  config.mockResolvedValue(LOADED);
});

describe("TravPlanSettings", () => {
  it("switches TravPlan on by saving the switch alone", async () => {
    setConfig.mockResolvedValue({ ...LOADED, enabled: true });
    renderSettings();
    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(setConfig).toHaveBeenCalledWith({ enabled: true });
    expect(await screen.findByRole("switch")).toBeChecked();
  });

  it("keeps the old state and says so when the save fails", async () => {
    setConfig.mockRejectedValue(new Error("offline"));
    renderSettings();
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:travPlan.errors.saveFailed");
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("shows PLAN_DISABLED as its own copy", async () => {
    setConfig.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "PLAN_DISABLED", error: "off" } },
    });
    renderSettings();
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:travPlan.errors.disabled");
  });

  it("says when the switch cannot be loaded, and draws none", async () => {
    config.mockRejectedValue(new Error("offline"));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:travPlan.errors.loadFailed");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("links to TravPlan's own configuration for the daily limits", async () => {
    renderSettings();
    await screen.findByRole("switch");
    expect(screen.getByRole("link", { name: "admin:travPlan.moreLink" })).toHaveAttribute(
      "href",
      "/plan/admin"
    );
  });
});
