import { describe, expect, it } from "vitest";
import de from "../../../i18n/resources/de/bus.json";
import en from "../../../i18n/resources/en/bus.json";
import { distanceSourceKey, fallbackReasonKey, saveGeometryNotice } from "../busRoutingWords";

const REASONS = [
  "no_provider",
  "unroutable_mode",
  "provider_error",
  "no_route",
  "point_not_near_road",
  "rate_limited",
  "auth",
  "untrustworthy",
] as const;

describe("busRoutingWords", () => {
  it("says Luftlinie only for a great-circle distance", () => {
    expect(de.distanceSource.great_circle).toBe("Luftlinie");
    expect(de.distanceSource.route).toBe("Straße");
    expect(de.distanceSource.user).toBe("laut Ticket");
    expect(en.distanceSource.route).toBe("Road");
    expect(distanceSourceKey("route")).toBe("bus:distanceSource.route");
    expect(distanceSourceKey(null)).toBeNull();
  });

  it.each(REASONS)("has a German and an English sentence for the reason %s", (reason) => {
    expect(fallbackReasonKey(reason)).toBe(`bus:routing.reason.${reason}`);
    expect(de.routing.reason[reason].length).toBeGreaterThan(10);
    expect(en.routing.reason[reason].length).toBeGreaterThan(10);
  });

  it("reads an unknown code from a newer server as a provider error, never a raw string", () => {
    expect(fallbackReasonKey("quota_exceeded_v2")).toBe("bus:routing.reason.provider_error");
  });

  it("owes a notice for a failed fetch or a kept line, but not for a missing provider or a clean save", () => {
    const base = { geometrySource: "straight" as const };
    expect(saveGeometryNotice(null)).toBeNull();
    expect(
      saveGeometryNotice({ ...base, outcome: "straight", fallback: "no_provider" })
    ).toBeNull();
    expect(saveGeometryNotice({ ...base, outcome: "routed", fallback: null })).toBeNull();
    expect(saveGeometryNotice({ ...base, outcome: "unchanged", fallback: null })).toBeNull();
    expect(saveGeometryNotice({ ...base, outcome: "straight", fallback: "auth" })).toEqual({
      key: "bus:routing.savedStraight",
      reasonKey: "bus:routing.reason.auth",
    });
    expect(
      saveGeometryNotice({ geometrySource: "road", outcome: "kept", fallback: "rate_limited" })
    ).toEqual({ key: "bus:routing.savedKept", reasonKey: "bus:routing.reason.rate_limited" });
  });
});
