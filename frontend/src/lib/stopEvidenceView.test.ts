import { describe, expect, it } from "vitest";
import { stopEvidenceView } from "./stopEvidenceView";

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
