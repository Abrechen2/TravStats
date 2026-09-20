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

// Mirrors the real matcher: newest entry that is not in the future.
const ENTRY = { version: "2.3.0", highlights: [{ icon: "X", titleKey: "a", bodyKey: "b" }] };
vi.mock("../../content/whatsNew", async (importActual) => ({
  compareVersions: (await importActual<typeof import("../../content/whatsNew")>()).compareVersions,
  findEntryForVersion: (v: string) => {
    const [maj, min] = v.split(".").map(Number);
    return maj > 2 || (maj === 2 && min >= 3) ? ENTRY : undefined;
  },
}));

import { useWhatsNew } from "../useWhatsNew";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVersion.mockResolvedValue({ version: "2.3.0" });
  mocks.getSettings.mockResolvedValue({});
  mocks.updateSettings.mockResolvedValue({});
});

describe("useWhatsNew", () => {
  it("shows when an entry exists and the version was never seen", async () => {
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    expect(result.current.entry?.version).toBe("2.3.0");
  });

  it("hides when the ENTRY's version was already seen", async () => {
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.3.0" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  /**
   * The regression this guards: "seen" used to be compared against the RUNNING
   * version. Since the matcher resolves with <=, a user on 2.3.1 gets the 2.3.0
   * entry — dismissal stores "2.3.0", but the check compared it to "2.3.1" and
   * never matched, so the modal returned on every single load.
   */
  it("stays hidden on a later patch once the entry was dismissed", async () => {
    mocks.getVersion.mockResolvedValue({ version: "2.3.1" });
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.3.0" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("still shows on a later patch when the entry was never dismissed", async () => {
    mocks.getVersion.mockResolvedValue({ version: "2.3.1" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    expect(result.current.entry?.version).toBe("2.3.0");
  });

  /**
   * A NEW account is stamped server-side with the RUNNING version
   * (`services/whatsNewStamp.ts`: "nothing is new to an account created a
   * moment ago"), while a dismissal stores the ENTRY's version. On a patch past
   * the entry the two differ — 2.6.3 against 2.6.0 — and an exact comparison
   * showed "Neu in TravStats 2.6.0" to every account created on 2.6.1 or later.
   * Found by the auth-ladder E2E spec, whose freshly created user met the modal
   * over the settings page.
   */
  it("stays hidden for a fresh account stamped with a later running version", async () => {
    mocks.getVersion.mockResolvedValue({ version: "2.3.1" });
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.3.1" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("still shows when the seen version is OLDER than the entry", async () => {
    mocks.getVersion.mockResolvedValue({ version: "2.3.1" });
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.2.9" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
  });

  it("hides when no entry exists for the running version", async () => {
    mocks.getVersion.mockResolvedValue({ version: "2.2.2" });
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
    await act(async () => {
      await result.current.dismiss();
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ whatsNewSeenVersion: "2.3.0" });
    expect(result.current.shouldShow).toBe(false);
  });

  it("stays hidden when the dismiss PUT fails", async () => {
    mocks.updateSettings.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides when /version rejects", async () => {
    mocks.getVersion.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  /**
   * `checked` is what the telemetry consent step waits on (owner decision
   * 2026-09-20). It must settle on EVERY path, including the ones that hide
   * the modal — otherwise the consent dialog never appears on the instances
   * that have no release notes to show, which is most of them.
   */
  describe("checked — the signal the consent step waits on", () => {
    it("is false until the check has answered", async () => {
      const { result } = renderHook(() => useWhatsNew(true));
      expect(result.current.checked).toBe(false);
      await waitFor(() => expect(result.current.checked).toBe(true));
    });

    it("settles when the modal is shown", async () => {
      const { result } = renderHook(() => useWhatsNew(true));
      await waitFor(() => expect(result.current.shouldShow).toBe(true));
      expect(result.current.checked).toBe(true);
    });

    it("settles when there is nothing to show", async () => {
      mocks.getVersion.mockResolvedValue({ version: "2.2.2" });
      const { result } = renderHook(() => useWhatsNew(true));
      await waitFor(() => expect(result.current.checked).toBe(true));
      expect(result.current.shouldShow).toBe(false);
    });

    it("settles when the entry was already seen", async () => {
      mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.3.0" });
      const { result } = renderHook(() => useWhatsNew(true));
      await waitFor(() => expect(result.current.checked).toBe(true));
      expect(result.current.shouldShow).toBe(false);
    });

    it("settles when the request fails", async () => {
      mocks.getVersion.mockRejectedValue(new Error("offline"));
      const { result } = renderHook(() => useWhatsNew(true));
      await waitFor(() => expect(result.current.checked).toBe(true));
      expect(result.current.shouldShow).toBe(false);
    });

    it("stays false while unauthenticated — nothing was checked", async () => {
      const { result } = renderHook(() => useWhatsNew(false));
      await waitFor(() => expect(result.current.shouldShow).toBe(false));
      expect(result.current.checked).toBe(false);
    });
  });
});
