import { renderHook, act, waitFor } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutoUpdateSection from "../AutoUpdateSection";
import { MemoryRouter } from "react-router-dom";

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
  useAuthStore: () => ({ user: { id: "u1", username: "admin", isAdmin: false } }),
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
      await result.current.saveAutoUpdateSettings({
        ...result.current.autoUpdateSettings,
        enabled: true,
      });
      await result.current.saveHistoricalEnrichmentSettings({
        ...result.current.historicalEnrichmentSettings,
        enabled: true,
      });
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
      await result.current.saveAutoUpdateSettings({
        ...result.current.autoUpdateSettings,
        requireApproval: true,
      });
    });
    expect(mocks.update).toHaveBeenCalledWith({
      autoUpdate: { ...REAL.autoUpdate, requireApproval: true },
    });
  });

  it("shows the failure and a retry instead of the switches", () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <AutoUpdateSection
          autoUpdateSettings={REAL.autoUpdate}
          loadingAutoUpdateSettings={false}
          loadState="failed"
          onRetryLoad={retry}
          onSetAutoUpdateSettings={vi.fn()}
          onSave={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalled();
  });
});
