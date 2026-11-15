import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A logout the server could not process used to vanish into the log: the user
 * was signed out locally and never learned the session may still be valid on
 * the server. They still are signed out locally - and now told.
 */

vi.mock("../../lib/api", () => ({ authApi: { logout: vi.fn() } }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { authApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../authStore";
import { useToastStore } from "../toastStore";

const ME = { id: "user-a", username: "a", isAdmin: false };
const logout = vi.mocked(authApi.logout);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  logout.mockReset();
  useAuthStore.getState().setAuth(ME);
});

describe("authStore.logout when the server cannot end the session", () => {
  it("signs out locally, logs it and shows a notice that the server session may remain", async () => {
    logout.mockRejectedValueOnce(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
  });

  it("shows no notice when the server already dropped the session (401)", async () => {
    logout.mockRejectedValueOnce(Object.assign(new Error("no"), { response: { status: 401 } }));
    await useAuthStore.getState().logout({ keepLocalDrafts: true });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("shows no notice on a clean logout", async () => {
    logout.mockResolvedValueOnce(undefined as never);
    await useAuthStore.getState().logout();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
