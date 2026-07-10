import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  versionApi: { get: mocks.getVersion },
  settingsApi: { get: mocks.getSettings, update: mocks.updateSettings },
}));

vi.mock("../../content/whatsNew", () => ({
  findEntryForVersion: (v: string) =>
    v === "2.4.0" ? { version: "2.4.0", highlights: [{ icon: "X", titleKey: "a", bodyKey: "b" }] } : undefined,
}));

import { useWhatsNew } from "../useWhatsNew";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVersion.mockResolvedValue({ version: "2.4.0" });
  mocks.getSettings.mockResolvedValue({});
  mocks.updateSettings.mockResolvedValue({});
});

describe("useWhatsNew", () => {
  it("shows when an entry exists and the version was never seen", async () => {
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    expect(result.current.entry?.version).toBe("2.4.0");
  });

  it("hides when the running version was already seen", async () => {
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.4.0" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides when no entry exists for the running version", async () => {
    mocks.getVersion.mockResolvedValue({ version: "9.9.9" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("never calls the API when unauthenticated", async () => {
    const { result } = renderHook(() => useWhatsNew(false));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    expect(mocks.getVersion).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("dismiss persists the version and hides the modal", async () => {
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ whatsNewSeenVersion: "2.4.0" });
    expect(result.current.shouldShow).toBe(false);
  });

  it("stays hidden when the dismiss PUT fails", async () => {
    mocks.updateSettings.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides when /version rejects", async () => {
    mocks.getVersion.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });
});
