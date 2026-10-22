import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Codex review before 2.7.0-rc.20: a bahn.de hand-over waiting in this tab's
 * session storage survived a deliberate logout, so the next account to sign in
 * in the tab was sent to it. An expired session keeps it — that is the
 * same-account recovery it exists for.
 */

vi.mock("../../lib/api", () => ({ authApi: { logout: vi.fn() } }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useAuthStore } from "../authStore";
import { stashBahnHandoff, takeStashedBahnHandoff } from "../../lib/rail/bahnHandoff";

const ME = { id: "user-a", username: "a", isAdmin: false };

afterEach(() => sessionStorage.clear());

describe("authStore and a waiting bahn.de hand-over", () => {
  it("a deliberate logout drops it", async () => {
    useAuthStore.getState().setAuth(ME);
    stashBahnHandoff("#e=blocked", Date.now(), ME.id);
    await useAuthStore.getState().logout();
    expect(takeStashedBahnHandoff(Date.now(), ME.id)).toBeNull();
  });

  it("an expired session keeps it for the same account", async () => {
    useAuthStore.getState().setAuth(ME);
    stashBahnHandoff("#e=blocked", Date.now(), ME.id);
    await useAuthStore.getState().logout({ keepLocalDrafts: true });
    expect(takeStashedBahnHandoff(Date.now(), ME.id)).toBe("#e=blocked");
  });
});
