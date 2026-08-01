import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  authApi: { me: mocks.me, logout: mocks.logout },
}));

import { useSessionValidation } from "../useSessionValidation";
import { useAuthStore } from "../../store/authStore";

const USER = { id: "u1", username: "dennis", isAdmin: true } as never;

/** Axios rejects with an error carrying `response.status`; mirror that shape. */
const httpError = (status: number) => ({ response: { status } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.me.mockResolvedValue({ user: USER });
  useAuthStore.setState({ user: null, _hasHydrated: true });
});

describe("useSessionValidation", () => {
  it("skips the network call when no user is persisted", async () => {
    const { result } = renderHook(() => useSessionValidation());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(mocks.me).not.toHaveBeenCalled();
  });

  it("keeps the user signed in when the server confirms the session", async () => {
    useAuthStore.setState({ user: USER, _hasHydrated: true });

    const { result } = renderHook(() => useSessionValidation());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(mocks.me).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  // The bug this guards: the cookie expires after 7 days but the persisted user
  // has no expiry, so the app booted "logged in" and fired its whole dashboard
  // fetch burst into six 401s before the interceptor's fallback redirected.
  it("clears the persisted user when the server rejects the session with 401", async () => {
    useAuthStore.setState({ user: USER, _hasHydrated: true });
    mocks.me.mockRejectedValue(httpError(401));

    const { result } = renderHook(() => useSessionValidation());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(useAuthStore.getState().user).toBeNull();
  });

  // A server outage must not log everybody out — only an explicit 401 does.
  it("keeps the user when validation fails for a non-auth reason", async () => {
    useAuthStore.setState({ user: USER, _hasHydrated: true });
    mocks.me.mockRejectedValue(httpError(503));

    const { result } = renderHook(() => useSessionValidation());

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it("waits for the auth store to hydrate before deciding", async () => {
    useAuthStore.setState({ user: null, _hasHydrated: false });

    const { result } = renderHook(() => useSessionValidation());

    expect(result.current.sessionChecked).toBe(false);
    expect(mocks.me).not.toHaveBeenCalled();

    useAuthStore.setState({ user: USER, _hasHydrated: true });

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
    expect(mocks.me).toHaveBeenCalledTimes(1);
  });

  // Found in the browser, not by the tests above: the axios interceptor reacts
  // to the same 401 by logging the user out, so `user` flips to null while the
  // validation request is still in flight. When that re-ran the effect, its
  // cleanup cancelled the pending check and `sessionChecked` never became true
  // — the app hung on the loading screen forever.
  it("still finishes the check when the user is cleared mid-flight", async () => {
    useAuthStore.setState({ user: USER, _hasHydrated: true });
    let rejectValidation: (reason: unknown) => void = () => {};
    mocks.me.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectValidation = reject;
      })
    );

    const { result } = renderHook(() => useSessionValidation());

    // The interceptor's logout lands before our own catch runs.
    act(() => {
      useAuthStore.setState({ user: null });
    });
    await act(async () => {
      rejectValidation(httpError(401));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.sessionChecked).toBe(true));
  });

  it("validates only once per mount", async () => {
    useAuthStore.setState({ user: USER, _hasHydrated: true });

    const { result, rerender } = renderHook(() => useSessionValidation());
    await waitFor(() => expect(result.current.sessionChecked).toBe(true));

    rerender();
    rerender();

    expect(mocks.me).toHaveBeenCalledTimes(1);
  });
});
