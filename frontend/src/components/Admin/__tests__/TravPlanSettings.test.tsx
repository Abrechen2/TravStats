import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const { config, setConfig } = vi.hoisted(() => ({ config: vi.fn(), setConfig: vi.fn() }));
vi.mock("../../../lib/api/travplan", async (original) => ({
  ...(await original<typeof import("../../../lib/api/travplan")>()),
  travplanApi: { config, setConfig, capabilities: vi.fn() },
}));

import TravPlanSettings from "../TravPlanSettings";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

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
  // The daily limits are expert rows (levels-discovery).
  useSettingsLevelStore.setState({ level: "expert" });
  config.mockResolvedValue(LOADED);
});

afterEach(() => {
  cleanup();
  act(() => useSettingsLevelStore.setState({ level: null }));
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

  it("shows the daily limits as the expert half of the one canonical form, and saves them alone", async () => {
    setConfig.mockResolvedValue({ ...LOADED, aiDailyLimit: 12 });
    renderSettings();
    const ai = await screen.findByLabelText("admin:travPlan.limits.aiDailyLimit");
    expect(ai).toHaveValue(7);
    await userEvent.clear(ai);
    await userEvent.type(ai, "12");
    await userEvent.click(screen.getByRole("button", { name: "admin:travPlan.limits.save" }));
    expect(setConfig).toHaveBeenCalledWith({ aiDailyLimit: 12, weatherDailyLimit: 15 });
  });

  it("keeps a failed limits save visible with a retry, instead of leaving the page", async () => {
    setConfig.mockRejectedValueOnce(new Error("offline"));
    renderSettings();
    const ai = await screen.findByLabelText("admin:travPlan.limits.aiDailyLimit");
    await userEvent.clear(ai);
    await userEvent.type(ai, "9");
    await userEvent.click(screen.getByRole("button", { name: "admin:travPlan.limits.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:travPlan.errors.saveFailed");
    setConfig.mockResolvedValue({ ...LOADED, aiDailyLimit: 9 });
    await userEvent.click(screen.getByRole("button", { name: "admin:travPlan.limits.retry" }));
    expect(setConfig).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("no longer links to a second editor, and explains the account defaults", async () => {
    renderSettings();
    await screen.findByRole("switch");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("admin:travPlan.defaultsNote")).toBeInTheDocument();
  });
});
