import { renderHook, act, waitFor } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutoUpdateSection from "../AutoUpdateSection";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: vi.fn().mockResolvedValue({ updates: [], count: 0 }) },
}));

const mocks = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn() }));

vi.mock("../../../lib/api", () => ({
  settingsApi: {
    update: mocks.update,
    updateProfile: vi.fn(),
    getApiKeys: vi.fn().mockResolvedValue({}),
    get: mocks.get,
    getProfile: vi.fn().mockResolvedValue({ birthdate: null }),
  },
  authApi: { me: vi.fn().mockResolvedValue(null) },
  backupApi: { getInfo: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (
    (state: Record<string, unknown>) => (select?: (s: Record<string, unknown>) => unknown) =>
      select ? select(state) : state
  )({ user: { id: "u1", username: "admin", isAdmin: false } }),
}));
vi.mock("../../../store/settingsStore", async () =>
  vi.importActual("../../../store/settingsStore")
);

import { useSettingsPage } from "../useSettingsPage";

const REAL = {
  autoUpdate: {
    enabled: true,
    requireApproval: false,
    checkInterval: 45,
    onlyDuringFlight: false,
    expiryHours: 72,
  },
  historicalEnrichment: { enabled: true, minConfidence: 85, maxPerDay: 200 },
};

describe("auto-update / enrichment after a failed settings load (forgejo#373)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not PUT default-built objects when the load failed, and says so", async () => {
    mocks.get.mockRejectedValue(new Error("503"));
    const { result } = renderHook(() => useSettingsPage());
    await waitFor(() => expect(result.current.serverSettingsLoad).toBe("failed"));

    await act(async () => {
      await expect(result.current.saveAutoUpdateSettings({ enabled: true })).rejects.toMatchObject({
        reason: "notLoaded",
      });
      await expect(
        result.current.saveHistoricalEnrichmentSettings({ enabled: true })
      ).rejects.toMatchObject({ reason: "notLoaded" });
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves the server's untouched fields once a retry succeeds", async () => {
    mocks.get.mockRejectedValueOnce(new Error("503")).mockResolvedValue(REAL);
    const { result } = renderHook(() => useSettingsPage());
    await waitFor(() => expect(result.current.serverSettingsLoad).toBe("failed"));
    await act(async () => {
      await result.current.reloadServerSettings();
    });
    expect(result.current.serverSettingsLoad).toBe("loaded");
    await act(async () => {
      await result.current.saveAutoUpdateSettings({ requireApproval: true });
    });
    expect(mocks.update).toHaveBeenCalledWith({
      autoUpdate: { ...REAL.autoUpdate, requireApproval: true },
    });
  });

  it("two saves in a row build on each other, and a refused one leaves the confirmed object alone", async () => {
    mocks.get.mockResolvedValue(REAL);
    const { result } = renderHook(() => useSettingsPage());
    await waitFor(() => expect(result.current.serverSettingsLoad).toBe("loaded"));
    mocks.update.mockRejectedValueOnce(new Error("503")).mockResolvedValue(undefined);
    await act(async () => {
      const first = result.current.saveAutoUpdateSettings({ requireApproval: true });
      const second = result.current.saveAutoUpdateSettings({ expiryHours: 10 });
      await expect(first).rejects.toThrow("503");
      await second;
    });
    // The refused change is not part of what the second one sent, and the state
    // is not rolled back or toasted — the row owns the retry.
    expect(mocks.update).toHaveBeenLastCalledWith({
      autoUpdate: { ...REAL.autoUpdate, expiryHours: 10 },
    });
    expect(result.current.autoUpdateSettings.requireApproval).toBe(false);
  });

  it("shows the failure and a retry instead of the switches", () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <AutoUpdateSection
          autoUpdateSettings={REAL.autoUpdate}
          loadState="failed"
          onRetryLoad={retry}
          onSave={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalled();
  });
});
