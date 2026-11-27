import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { EVIDENCE_THRESHOLDS, stopEvidenceView } from "./stopEvidenceView";

// The same truth table as backend/src/services/travtrack/legs/__tests__/stopEvidence.test.ts.
const visit = (distanceM: number, minutes: number) => ({
  visit: { distanceM, durationMs: minutes * 60_000, venue: { name: "Lidl" } },
});

describe("stopEvidenceView (mirror of the server's)", () => {
  it("no evidence, no view", () => {
    expect(stopEvidenceView(null)).toBeNull();
    expect(stopEvidenceView({})).toBeNull();
  });
  it("venue only: medium for a near venue and a long stay, low for a far one", () => {
    expect(stopEvidenceView(visit(38, 52))!.confidence?.level).toBe("medium");
    expect(
      stopEvidenceView({ ...visit(38, 52), calendar: { title: "M" } })!.confidence?.level
    ).toBe("high");
    expect(stopEvidenceView(visit(400, 12))!.confidence?.level).toBe("low");
  });
  it("a plugin names the stop; a doubtful one and a context-only calendar count less", () => {
    const sure = stopEvidenceView({
      plugins: [{ pluginName: "P", name: "N", note: "Kunde", distanceM: 100, confidence: 0.9 }],
    })!;
    expect(sure.source).toEqual({ kind: "plugin", pluginName: "P", name: "N", note: "Kunde" });
    expect(sure.confidence?.level).toBe("medium");
    expect(
      stopEvidenceView({
        plugins: [{ pluginName: "P", name: "N", note: null, distanceM: 100, confidence: 0.3 }],
      })!.confidence?.level
    ).toBe("low");
    expect(
      stopEvidenceView({ calendar: { title: "T", match: "context" } })!.confidence?.level
    ).toBe("low");
  });
  it("a dwell alone, or a venue without a distance, gives no confidence (no meter)", () => {
    expect(
      stopEvidenceView({ visit: { durationMs: 3_600_000, venue: { name: "X" } } })!.confidence
    ).toBeNull();
    expect(
      stopEvidenceView({ visit: { distanceM: null, durationMs: 3_600_000, venue: { name: "X" } } })!
        .confidence
    ).toBeNull();
  });
});

describe("the thresholds the „Warum?“ line explains", () => {
  // The explanation reads EVIDENCE_THRESHOLDS; the server computes the stop's level. Both must
  // name the same numbers, or the page would explain a scale the server does not use.
  it("are the server's own numbers", () => {
    const server = fs.readFileSync(
      path.resolve(__dirname, "../../../backend/src/services/travtrack/legs/stopEvidence.ts"),
      "utf8"
    );
    const value = (name: string): number => {
      const m = new RegExp(`const ${name} = (\\d+);`).exec(server);
      if (!m) throw new Error(`${name} not found in the server's stopEvidence.ts`);
      return Number(m[1]);
    };
    expect(EVIDENCE_THRESHOLDS).toEqual({
      highPoints: value("HIGH_POINTS"),
      mediumPoints: value("MEDIUM_POINTS"),
      nearVenueM: value("NEAR_VENUE_M"),
      closeVenueM: value("CLOSE_VENUE_M"),
      nearPluginM: value("NEAR_PLUGIN_M"),
      farPluginM: value("FAR_PLUGIN_M"),
      longDwellMin: value("LONG_DWELL_MIN"),
    });
  });
});
