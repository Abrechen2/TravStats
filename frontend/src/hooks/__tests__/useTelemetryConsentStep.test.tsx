import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../lib/api", () => ({
  usageStatsApi: { get: mocks.get, setConsent: vi.fn() },
}));

import { useTelemetryConsentStep } from "../useTelemetryConsentStep";

const status = (consent: "unset" | "granted" | "denied") => ({
  consent,
  installId: "install-1",
  endpointConfigured: true,
});

/** The steady state: the what's-new check has settled and shows nothing. */
const AFTER_WHATS_NEW = { whatsNewChecked: true, whatsNewOpen: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(status("unset"));
});

describe("useTelemetryConsentStep", () => {
  it("asks an admin once, when nothing was ever answered", async () => {
    const { result } = renderHook(() =>
      useTelemetryConsentStep({ isAdminSession: true, ...AFTER_WHATS_NEW })
    );
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
  });

  it("never asks a non-admin — the consent is instance-wide", async () => {
    const { result } = renderHook(() =>
      useTelemetryConsentStep({ isAdminSession: false, ...AFTER_WHATS_NEW })
    );
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each(["granted", "denied"] as const)("never asks again once the answer is %s", async (c) => {
    mocks.get.mockResolvedValue(status(c));
    const { result } = renderHook(() =>
      useTelemetryConsentStep({ isAdminSession: true, ...AFTER_WHATS_NEW })
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("stays out of the way while the what's-new dialog is on screen", async () => {
    const { result } = renderHook(() =>
      useTelemetryConsentStep({
        isAdminSession: true,
        whatsNewChecked: true,
        whatsNewOpen: true,
      })
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  /**
   * The race the `checked` flag exists for. Both what's-new flags are false
   * while its version request is in flight, so waiting on `!whatsNewOpen`
   * alone would show this dialog first and bury it under the release notes a
   * moment later — the opposite of the owner's 2026-09-20 ruling.
   */
  it("waits for the what's-new check to settle before showing anything", async () => {
    const { result, rerender } = renderHook(
      (props: { whatsNewChecked: boolean; whatsNewOpen: boolean }) =>
        useTelemetryConsentStep({ isAdminSession: true, ...props }),
      { initialProps: { whatsNewChecked: false, whatsNewOpen: false } }
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);

    rerender({ whatsNewChecked: true, whatsNewOpen: false });
    expect(result.current.shouldShow).toBe(true);
  });

  it("appears exactly once, right after the what's-new is dismissed", async () => {
    const { result, rerender } = renderHook(
      (props: { whatsNewChecked: boolean; whatsNewOpen: boolean }) =>
        useTelemetryConsentStep({ isAdminSession: true, ...props }),
      { initialProps: { whatsNewChecked: true, whatsNewOpen: true } }
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);

    rerender({ whatsNewChecked: true, whatsNewOpen: false });
    expect(result.current.shouldShow).toBe(true);

    act(() => result.current.close());
    expect(result.current.shouldShow).toBe(false);

    // Nothing re-opens it for the rest of the session.
    rerender({ whatsNewChecked: true, whatsNewOpen: false });
    expect(result.current.shouldShow).toBe(false);
  });

  it("asks nothing when the status request fails", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useTelemetryConsentStep({ isAdminSession: true, ...AFTER_WHATS_NEW })
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });
});
