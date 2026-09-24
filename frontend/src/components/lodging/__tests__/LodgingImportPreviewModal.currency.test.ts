import { describe, expect, it } from "vitest";

import { currencyOptionGroups } from "../LodgingImportPreviewModal";

/**
 * AUD-057 (re-check 13.09.): a row whose parser left the currency empty could
 * only be completed in an ECB currency. Dirham and dinar, which the server
 * accepts, could be kept but never chosen.
 */
describe("currencyOptionGroups", () => {
  it("offers AED and KWD when the row has no currency yet", () => {
    const { frequent, rest } = currencyOptionGroups(null);
    expect([...frequent, ...rest]).toEqual(expect.arrayContaining(["AED", "KWD", "EUR"]));
  });

  it("puts the ECB set first and lists every code once", () => {
    const { frequent, rest } = currencyOptionGroups(null);
    expect(frequent).toContain("EUR");
    expect(rest).not.toContain("EUR");
    const all = [...frequent, ...rest];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps a non-ECB currency the row already carries at the top", () => {
    expect(currencyOptionGroups("AED").frequent[0]).toBe("AED");
    expect(currencyOptionGroups("AED").rest).not.toContain("AED");
  });
});
