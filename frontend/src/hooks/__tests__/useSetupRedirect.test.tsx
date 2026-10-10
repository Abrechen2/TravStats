import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ getStatus: vi.fn(), navigate: vi.fn() }));

vi.mock("../../lib/api", () => ({
  setupApi: { getStatus: mocks.getStatus },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { useSetupRedirect } from "../useSetupRedirect";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSetupRedirect", () => {
  // Regression guard: this is the behaviour that already worked and must
  // keep working — an anonymous visitor is bounced to /setup immediately.
  it("redirects an anonymous visitor to /setup once the session check has settled", async () => {
    mocks.getStatus.mockResolvedValue({ requiresSetup: true, setupComplete: false, message: "" });
    const { result } = renderHook(
      () => useSetupRedirect({ sessionChecked: true, isAuthenticated: false }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.setupChecked).toBe(true));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/setup"));
  });

  // The bug this hook exists to fix: an authenticated session (the demo
  // account, before any admin exists) must NOT be bounced back to /setup on
  // every load.
  it("does not redirect an authenticated session, even while setup is still required", async () => {
    mocks.getStatus.mockResolvedValue({ requiresSetup: true, setupComplete: false, message: "" });
    const { result } = renderHook(
      () => useSetupRedirect({ sessionChecked: true, isAuthenticated: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.setupChecked).toBe(true));
    expect(result.current.requiresSetup).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("waits for the session check to settle before deciding, even for an anonymous claim", async () => {
    mocks.getStatus.mockResolvedValue({ requiresSetup: true, setupComplete: false, message: "" });
    const { result, rerender } = renderHook(
      (props: { sessionChecked: boolean; isAuthenticated: boolean }) => useSetupRedirect(props),
      { wrapper, initialProps: { sessionChecked: false, isAuthenticated: false } }
    );

    await waitFor(() => expect(result.current.setupChecked).toBe(true));
    expect(mocks.navigate).not.toHaveBeenCalled();

    rerender({ sessionChecked: true, isAuthenticated: false });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/setup"));
  });

  it("does not redirect while setup is not required", async () => {
    mocks.getStatus.mockResolvedValue({ requiresSetup: false, setupComplete: true, message: "" });
    const { result } = renderHook(
      () => useSetupRedirect({ sessionChecked: true, isAuthenticated: false }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.setupChecked).toBe(true));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("marks the check done even when the status request fails, and never redirects on it", async () => {
    mocks.getStatus.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(
      () => useSetupRedirect({ sessionChecked: true, isAuthenticated: false }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.setupChecked).toBe(true));
    expect(result.current.requiresSetup).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  // forgejo#88 acceptance, 2026-10-10: completing /setup signs the admin in
  // without a reload. The status read on mount said "setup required", and
  // nothing asked again — the new admin's dashboard announced that the
  // instance was not set up.
  it("asks again once the session becomes authenticated", async () => {
    mocks.getStatus.mockResolvedValueOnce({
      requiresSetup: true,
      setupComplete: false,
      message: "",
    });
    const { result, rerender } = renderHook(
      (props: { sessionChecked: boolean; isAuthenticated: boolean }) => useSetupRedirect(props),
      { wrapper, initialProps: { sessionChecked: true, isAuthenticated: false } }
    );
    await waitFor(() => expect(result.current.requiresSetup).toBe(true));

    mocks.getStatus.mockResolvedValueOnce({
      requiresSetup: false,
      setupComplete: true,
      message: "",
    });
    rerender({ sessionChecked: true, isAuthenticated: true });

    await waitFor(() => expect(result.current.requiresSetup).toBe(false));
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
  });
});
