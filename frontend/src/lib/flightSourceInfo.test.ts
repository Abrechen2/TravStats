import { describe, it, expect } from "vitest";
import { getFlightSourceInfo } from "./flightSourceInfo";
import type { Flight } from "../types";

describe("getFlightSourceInfo", () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts?.count !== undefined ? `${key}:${opts.count}` : key;
  const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

  it("is empty for a plain manual flight", () => {
    expect(getFlightSourceInfo({ ...base, dataSource: "manual" }, t)).toEqual([]);
  });

  it("reports an email import", () => {
    const lines = getFlightSourceInfo({ ...base, dataSource: "email_import" }, t);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe("flights:dataSource.email_import");
    expect(lines[0].icon).toBe("📧");
  });

  it("combines live_update + auto_update into one line", () => {
    const lines = getFlightSourceInfo(
      { ...base, dataSource: "live_update", lastModifiedBy: "auto_update" }, t);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe("flights:dataSource.live_update_auto");
  });

  it("adds an enrichment line with confidence detail", () => {
    const lines = getFlightSourceInfo({
      ...base, dataSource: "manual",
      enrichmentHistory: [{ type: "historical", timestamp: "2026-07-04T00:00:00Z", confidence: 92, sourceFlightsCount: 14 }],
    } as unknown as Flight, t);
    expect(lines).toHaveLength(1);
    expect(lines[0].icon).toBe("🔍");
    expect(lines[0].detail).toContain("92");
  });

  it("attaches enrichment details to the historical_enrichment primary line", () => {
    const lines = getFlightSourceInfo({
      ...base, dataSource: "historical_enrichment",
      enrichmentHistory: [{ type: "historical", timestamp: "2026-07-04T00:00:00Z", confidence: 88, sourceFlightsCount: 9 }],
    } as unknown as Flight, t);
    expect(lines).toHaveLength(1);
    expect(lines[0].icon).toBe("🔍");
    expect(lines[0].detail).toContain("88");
  });
});
