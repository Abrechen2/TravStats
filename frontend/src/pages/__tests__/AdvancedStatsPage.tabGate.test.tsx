import { describe, it, expect } from "vitest";

import { resolveStatsTab, visibleStatsTabs } from "../statsTabAccess";

/**
 * A deep link must not open a tab the reader does not have.
 *
 * The tab STRIP is built from the user's enabled domains, so a switched-off
 * domain has no button. The filter itself was read straight out of `?tab=`
 * with no such check, so `/stats?tab=poi` drew the POI statistics for an
 * account that had turned the domain off — and on an instance where the beta
 * flag was off altogether. Gated chrome, ungated deep link: the same gap every
 * application that ever had one has had.
 *
 * POI needs three states rather than a boolean. `betaFeaturesEnabled` is
 * instance state that is deliberately never persisted, so it is `null` until
 * `GET /settings` answers. Treating that "don't know yet" as "no" is what
 * bounced people off /places on a hard reload — the mistake this codebase has
 * already made once and written down in `usePlacesVisible.ts`.
 */
describe("resolveStatsTab", () => {
  const enabled = ["flight", "cruise"] as const;

  it("keeps a tab the user has", () => {
    expect(resolveStatsTab("cruise", [...enabled], "denied")).toBe("cruise");
  });

  it("falls back to the overview for a domain the user switched off", () => {
    // A page, not a blank: the reader asked for statistics and should get some.
    expect(resolveStatsTab("lodging", [...enabled], "denied")).toBe("all");
  });

  it("refuses the POI tab when the instance does not allow it", () => {
    expect(resolveStatsTab("poi", ["flight", "poi"], "denied")).toBe("all");
  });

  it("keeps the POI tab while the instance flag is still unknown", () => {
    // The lesson from /places: deciding "not allowed" before the answer
    // arrives throws the reader off a page they explicitly asked for.
    expect(resolveStatsTab("poi", ["flight", "poi"], "pending")).toBe("poi");
  });

  it("opens the POI tab once the instance allows it", () => {
    expect(resolveStatsTab("poi", ["flight", "poi"], "allowed")).toBe("poi");
  });

  it("leaves the overview alone whatever the domains say", () => {
    expect(resolveStatsTab("all", [], "denied")).toBe("all");
  });

  it("asks usePlacesAccess alone about POI, not the domain list as well", () => {
    // That hook already answers BOTH halves — instance allows it, user wants
    // it. Consulting `enabled` here too would ask the same question twice and
    // let the two answers drift; "allowed" with poi absent from the list is a
    // state the hook cannot produce, so it is not encoded as one.
    expect(resolveStatsTab("poi", [], "allowed")).toBe("poi");
  });
});

// 2026-09-05, promote check with the beta flag off: the strip still drew
// "POI / Besuche" for an account that had the domain on from beta days.
describe("visibleStatsTabs", () => {
  it("drops the POI tab when the instance does not allow it", () => {
    expect(visibleStatsTabs(["flight", "cruise", "poi"], "denied")).toEqual(["flight", "cruise"]);
  });

  it("keeps the POI tab while the instance flag is still unknown", () => {
    expect(visibleStatsTabs(["flight", "poi"], "pending")).toEqual(["flight", "poi"]);
  });

  it("keeps the POI tab once the instance allows it", () => {
    expect(visibleStatsTabs(["flight", "poi"], "allowed")).toEqual(["flight", "poi"]);
  });

  it("never touches the other domains", () => {
    expect(visibleStatsTabs(["flight", "cruise", "lodging"], "denied")).toEqual([
      "flight",
      "cruise",
      "lodging",
    ]);
  });
});
