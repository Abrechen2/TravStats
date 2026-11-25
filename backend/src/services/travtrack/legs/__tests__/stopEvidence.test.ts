import { stopEvidenceView } from "../stopEvidence";

const visit = (distanceM: number, minutes: number) => ({
  visit: { distanceM, durationMs: minutes * 60_000, venue: { name: "Lidl" } },
});

describe("stopEvidenceView", () => {
  it("a stop with no evidence has no view, so the client draws no meter", () => {
    expect(stopEvidenceView(null)).toBeNull();
    expect(stopEvidenceView({})).toBeNull();
    expect(stopEvidenceView({ source: "travtrack" })).toBeNull();
  });

  it("a venue-only stop says so, and a near venue with a long stay is high", () => {
    const v = stopEvidenceView(visit(38, 52))!;
    expect(v.source).toEqual({ kind: "venue" });
    expect(v.confidence?.level).toBe("medium");
    expect(v.confidence?.reasons).toEqual([
      { code: "venue", distanceM: 38 },
      { code: "dwell", minutes: 52 },
    ]);
    expect(
      stopEvidenceView({ ...visit(38, 52), calendar: { title: "Meeting" } })!.confidence?.level
    ).toBe("high");
  });

  it("a far venue and a short stay is low", () => {
    expect(stopEvidenceView(visit(400, 12))!.confidence?.level).toBe("low");
  });

  it("a plugin suggestion names the stop and its reason carries the plugin and distance", () => {
    const v = stopEvidenceView({
      ...visit(300, 20),
      plugins: [
        { pluginName: "Projektarchiv", name: "MSA Zentralküche", note: "Kunde", distanceM: 780 },
        { pluginName: "Other", name: "Far", note: null, distanceM: 900 },
      ],
    })!;
    expect(v.source).toEqual({
      kind: "plugin",
      pluginName: "Projektarchiv",
      name: "MSA Zentralküche",
      note: "Kunde",
    });
    expect(v.confidence?.reasons).toContainEqual({
      code: "plugin",
      pluginName: "Projektarchiv",
      name: "MSA Zentralküche",
      distanceM: 780,
    });
  });

  it("a calendar match without a venue is the source and counts", () => {
    const v = stopEvidenceView({ calendar: { title: "Kundentermin" } })!;
    expect(v.source).toEqual({ kind: "calendar", title: "Kundentermin" });
    expect(v.confidence?.level).toBe("medium");
  });

  it("a dwell alone gives no confidence", () => {
    const v = stopEvidenceView({ visit: { durationMs: 3_600_000, venue: { name: "X" } } })!;
    expect(v.confidence).toBeNull();
  });
});

describe("stopEvidenceView — the evidence's own scores", () => {
  it("a plugin that doubts its answer and a context-only calendar event count one point less", () => {
    const doubtful = stopEvidenceView({
      plugins: [{ pluginName: "P", name: "N", note: null, distanceM: 100, confidence: 0.3 }],
    })!;
    const sure = stopEvidenceView({
      plugins: [{ pluginName: "P", name: "N", note: null, distanceM: 100, confidence: 0.9 }],
    })!;
    expect(doubtful.confidence?.level).toBe("low");
    expect(sure.confidence?.level).toBe("medium");
    expect(
      stopEvidenceView({ calendar: { title: "T", match: "context" } })!.confidence?.level
    ).toBe("low");
  });
});
