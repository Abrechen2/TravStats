import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Critical finding, review round 1 of the 2026-09-17 alex-design-feedback
 * task 2 fix: logout/login is an SPA navigation, not a page reload
 * (NavigationBar calls `logout()` then `navigate("/login")`; LoginPage calls
 * `setAuth()` then `navigate("/")` — see those files). The module-level
 * `dashboardCountsStore` introduced for the tab-strip-flicker fix therefore
 * survived an account switch, so user B could briefly see user A's counts
 * in the tab strip — worse than the zero flash the original fix removed.
 *
 * `clearSession` and `logout` must both reset the counts store.
 */

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  authApi: { logout: mocks.logout },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useAuthStore } from "../authStore";
import { useDashboardCountsStore } from "../dashboardCountsStore";
import { rememberQuotaRefused, wasQuotaRefused } from "../../lib/bulkRefreshRefusal";

function seedCounts(): void {
  useDashboardCountsStore
    .getState()
    .setCounts({ flight: 42, cruise: 3, poi: 1, lodging: 2, rail: 0 }, { flight: 1, cruise: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  useDashboardCountsStore.getState().reset();
});

describe("authStore: an account switch resets dashboardCountsStore (Critical, review round 1)", () => {
  it("clearSession drops the previous account's counts", () => {
    seedCounts();
    expect(useDashboardCountsStore.getState().counts.flight).toBe(42);

    useAuthStore.getState().clearSession();

    expect(useDashboardCountsStore.getState().counts).toEqual({
      flight: 0,
      cruise: 0,
      poi: 0,
      lodging: 0,
      rail: 0,
    });
    expect(useDashboardCountsStore.getState().countsLoaded).toBe(false);
  });

  it("logout drops the previous account's counts once the API call settles", async () => {
    mocks.logout.mockResolvedValue(undefined);
    seedCounts();
    expect(useDashboardCountsStore.getState().counts.flight).toBe(42);

    await useAuthStore.getState().logout();

    expect(useDashboardCountsStore.getState().counts).toEqual({
      flight: 0,
      cruise: 0,
      poi: 0,
      lodging: 0,
      rail: 0,
    });
    expect(useDashboardCountsStore.getState().countsLoaded).toBe(false);
  });

  it("logout drops the previous account's counts even when the server call fails", async () => {
    mocks.logout.mockRejectedValue(new Error("network error"));
    seedCounts();

    await useAuthStore.getState().logout();

    expect(useDashboardCountsStore.getState().counts.flight).toBe(0);
    expect(useDashboardCountsStore.getState().countsLoaded).toBe(false);
  });
});

/**
 * The same failure mode, found in review on 2026-09-19 one module along: the
 * bulk-refresh card remembers that the server refused THIS account's quota,
 * and that memory must not survive the account switch either. It sat in
 * `sessionStorage`, which no SPA navigation clears.
 */
describe("authStore: an account switch forgets the bulk-refresh refusal", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("clearSession forgets it", () => {
    rememberQuotaRefused("user-a");
    expect(wasQuotaRefused("user-a")).toBe(true);

    useAuthStore.getState().clearSession();

    expect(wasQuotaRefused("user-a")).toBe(false);
  });

  it("logout forgets it once the API call settles", async () => {
    mocks.logout.mockResolvedValue(undefined);
    rememberQuotaRefused("user-a");

    await useAuthStore.getState().logout();

    expect(wasQuotaRefused("user-a")).toBe(false);
  });

  it("forgets it even when the logout request fails", async () => {
    mocks.logout.mockRejectedValue(new Error("offline"));
    rememberQuotaRefused("user-a");

    await useAuthStore.getState().logout();

    expect(wasQuotaRefused("user-a")).toBe(false);
  });
});
