import { describe, it, expect, beforeEach } from "vitest";

import { forgetQuotaRefusals, rememberQuotaRefused, wasQuotaRefused } from "../bulkRefreshRefusal";

/**
 * Review, 2026-09-19. The refusal is the SERVER's answer about one account,
 * so it must not outlive that account's session — logout and login are SPA
 * navigations here, with no page reload to clear anything, which is the same
 * failure mode `authStore.clearSession` already documents for the dashboard
 * counts.
 */
describe("the remembered bulk-refresh refusal", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("belongs to the account it was given about", () => {
    rememberQuotaRefused("user-a");

    expect(wasQuotaRefused("user-a")).toBe(true);
    expect(wasQuotaRefused("user-b")).toBe(false);
  });

  it("is forgotten for every account when a session ends", () => {
    rememberQuotaRefused("user-a");
    rememberQuotaRefused("user-b");

    forgetQuotaRefusals();

    expect(wasQuotaRefused("user-a")).toBe(false);
    expect(wasQuotaRefused("user-b")).toBe(false);
  });

  /**
   * `sessionStorage.key(i)` re-indexes on every removal, so removing inside
   * the walk drops every second entry. Three keys is the smallest number that
   * shows it.
   */
  it("clears every key, not every second one", () => {
    rememberQuotaRefused("user-a");
    rememberQuotaRefused("user-b");
    rememberQuotaRefused("user-c");
    window.sessionStorage.setItem("travstats:unrelated", "keep");

    forgetQuotaRefusals();

    expect(wasQuotaRefused("user-a")).toBe(false);
    expect(wasQuotaRefused("user-b")).toBe(false);
    expect(wasQuotaRefused("user-c")).toBe(false);
    expect(window.sessionStorage.getItem("travstats:unrelated")).toBe("keep");
  });

  it("has nothing to say about an account that is not signed in", () => {
    rememberQuotaRefused(undefined);
    expect(wasQuotaRefused(undefined)).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });
});
