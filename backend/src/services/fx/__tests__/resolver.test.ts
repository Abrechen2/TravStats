import { getCdnRate } from "../currencyApiCdn";
import { getRate } from "../frankfurter";
import { getAdminFxSettings } from "../../parserSettings";
import { convertToBase, resolveRate } from "../resolver";

jest.mock("../frankfurter", () => ({ getRate: jest.fn() }));
jest.mock("../currencyApiCdn", () => ({ getCdnRate: jest.fn() }));
jest.mock("../../parserSettings", () => ({ getAdminFxSettings: jest.fn() }));

const ecb = getRate as jest.Mock;
const cdn = getCdnRate as jest.Mock;
const settings = getAdminFxSettings as jest.Mock;

describe("resolveRate", () => {
  beforeEach(() => {
    ecb.mockReset();
    cdn.mockReset();
    settings.mockReset();
  });

  it("uses the ECB when it can and never asks the CDN", async () => {
    ecb.mockResolvedValue({ rate: 0.085, source: "ecb" });
    const r = await resolveRate("NOK", "EUR", "2024-09-17");
    expect(r).toEqual({ rate: 0.085, source: "ecb" });
    expect(cdn).not.toHaveBeenCalled();
    // The switch is not even consulted for a query the ECB answered.
    expect(settings).not.toHaveBeenCalled();
  });

  it("falls to the CDN only when the ECB has nothing AND the switch is on", async () => {
    ecb.mockResolvedValue(null);
    settings.mockResolvedValue({ cdnFallbackEnabled: true });
    cdn.mockResolvedValue({ rate: 0.0195, source: "cdn" });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toEqual({
      rate: 0.0195,
      source: "cdn",
    });
  });

  it("respects an admin who switched the CDN off", async () => {
    ecb.mockResolvedValue(null);
    settings.mockResolvedValue({ cdnFallbackEnabled: false });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toBeNull();
    expect(cdn).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when both are dead", async () => {
    ecb.mockResolvedValue(null);
    settings.mockResolvedValue({ cdnFallbackEnabled: true });
    cdn.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolveRate("EGP", "EUR", "2026-03-04")).resolves.toBeNull();
  });

  it("still reaches the CDN when the ECB itself THROWS, not just returns null", async () => {
    // A dead provider must not take the chain down with it — that is the whole
    // point of asking a second one.
    ecb.mockRejectedValue(new Error("socket hang up"));
    settings.mockResolvedValue({ cdnFallbackEnabled: true });
    cdn.mockResolvedValue({ rate: 0.0195, source: "cdn" });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toEqual({
      rate: 0.0195,
      source: "cdn",
    });
  });

  it("treats an unreadable settings row as the CDN being on, matching the column default", async () => {
    ecb.mockResolvedValue(null);
    settings.mockRejectedValue(new Error("db down"));
    cdn.mockResolvedValue({ rate: 0.0195, source: "cdn" });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toEqual({
      rate: 0.0195,
      source: "cdn",
    });
  });
});

// These moved here from frankfurter.test.ts with the function itself: an
// amount is now converted by the CHAIN, not by one provider.
describe("convertToBase", () => {
  beforeEach(() => {
    ecb.mockReset();
    cdn.mockReset();
    settings.mockReset();
  });

  it("rounds the converted base amount to 2 decimals", async () => {
    ecb.mockResolvedValue({ rate: 1.0106, source: "ecb" });
    const out = await convertToBase(420, "CHF", "EUR", new Date("2024-05-21"));
    expect(out?.baseAmount).toBe(424.45); // 420 * 1.0106 = 424.452
    expect(out?.rate).toBeCloseTo(1.0106, 4);
    expect(out?.rateDate).toBe("2024-05-21");
    expect(out?.source).toBe("ecb");
  });

  it("carries the CDN through as the source when that is who answered", async () => {
    // The whole reason `source` exists: a stay converted through the CDN must
    // never be shown as an official ECB rate.
    ecb.mockResolvedValue(null);
    settings.mockResolvedValue({ cdnFallbackEnabled: true });
    cdn.mockResolvedValue({ rate: 0.017284254, source: "cdn" });
    const out = await convertToBase(11662, "EGP", "EUR", new Date("2026-03-04"));
    expect(out?.source).toBe("cdn");
    expect(out?.baseAmount).toBeCloseTo(201.57, 2);
  });

  it("returns null when no provider has a rate — never throws", async () => {
    ecb.mockResolvedValue(null);
    settings.mockResolvedValue({ cdnFallbackEnabled: true });
    cdn.mockResolvedValue(null);
    expect(await convertToBase(11662, "AED", "EUR", new Date("2023-04-30"))).toBeNull();
  });

  it("rejects an invalid date without asking any provider", async () => {
    expect(await convertToBase(100, "CHF", "EUR", new Date("not-a-date"))).toBeNull();
    expect(ecb).not.toHaveBeenCalled();
    expect(cdn).not.toHaveBeenCalled();
  });

  it("passes the UTC calendar day of the given instant, unshifted", async () => {
    // A late-evening check-in must snapshot the SAME day, not the next one.
    ecb.mockResolvedValue({ rate: 1, source: "ecb" });
    const out = await convertToBase(100, "USD", "EUR", new Date("2024-08-20T23:30:00.000Z"));
    expect(out?.rateDate).toBe("2024-08-20");
    expect(ecb).toHaveBeenCalledWith("USD", "EUR", "2024-08-20");
  });
});
