import { explanation, parseExplanation, toEnvelope } from "../envelope";

const legacyStay = {
  id: "s1",
  status: "pending",
  startAt: new Date("2026-10-11T09:00:00Z"),
  endAt: new Date("2026-10-11T10:30:00Z"),
  provider: "dawarich",
  providerRev: 0,
  algorithmVersion: 0,
  evidenceKey: "f".repeat(64),
  fingerprint: "e".repeat(64),
  evidence: {
    source: "dawarich",
    zone: "Asia/Seoul",
    pointIds: [41, 42, 43],
    maxGapMinutes: 4,
    uncertainties: [],
  },
};

describe("toEnvelope", () => {
  it("a legacy Dawarich stay maps to version 0", () => {
    const env = toEnvelope(legacyStay);
    expect(env).toEqual({
      id: "s1",
      kind: "stay",
      provider: { kind: "dawarich", rev: 0 },
      window: {
        fromMs: Date.parse("2026-10-11T09:00:00Z"),
        untilMs: Date.parse("2026-10-11T10:30:00Z"),
      },
      algorithm: { name: "stay", version: 0 },
      explanation: { code: "stay.legacy", params: {} },
      status: "pending",
      // A legacy row never recorded how complete its read was.
      coverage: null,
    });
  });

  it("a legacy market or venue finding keeps its kind and runs under the market algorithm", () => {
    const market = toEnvelope({
      ...legacyStay,
      evidence: { ...legacyStay.evidence, kind: "venue", market: { name: "x" } },
    });
    expect(market?.kind).toBe("venue");
    expect(market?.algorithm).toEqual({ name: "market", version: 0 });
    expect(market?.explanation).toEqual({ code: "market.legacy", params: {} });
  });

  it("an accepting stay reads as pending; covered and superseded stay themselves", () => {
    expect(toEnvelope({ ...legacyStay, status: "accepting" })?.status).toBe("pending");
    expect(toEnvelope({ ...legacyStay, status: "covered" })?.status).toBe("covered");
    expect(toEnvelope({ ...legacyStay, status: "superseded" })?.status).toBe("superseded");
    expect(toEnvelope({ ...legacyStay, status: "exploded" })).toBeNull();
  });

  it("the envelope carries no evidence key and no digest", () => {
    const digest = "0123456789abcdef0123456789abcdef";
    const stay = toEnvelope({
      ...legacyStay,
      provider: "travtrack",
      providerRev: 3,
      algorithmVersion: 1,
      evidence: {
        pointDigests: [digest],
        explanation: { code: "stay.dwell", params: { minutes: 90 } },
        readCoverage: "complete",
      },
    });
    // The stored row carries its key; the envelope must not.
    const suggestionRow = {
      id: "q1",
      kind: "country",
      provider: "travtrack",
      providerRev: 3,
      algorithm: 2,
      evidenceKey: "d".repeat(64),
      windowFrom: new Date("2026-10-11T00:00:00Z"),
      windowUntil: new Date("2026-10-12T00:00:00Z"),
      status: "accepting",
      explanation: { code: "country.days", params: { country: "KR", days: 1 } },
      evidence: { pointDigests: [digest], readCoverage: "truncated" },
    };
    const suggestion = toEnvelope(suggestionRow);
    for (const env of [stay, suggestion]) {
      const text = JSON.stringify(env);
      expect(text).not.toContain(digest);
      expect(text).not.toContain("d".repeat(64));
      expect(text).not.toContain("f".repeat(64));
      expect(text).not.toContain("e".repeat(64));
      expect(text).not.toMatch(/evidenceKey|fingerprint|pointDigests|pointIds/);
    }
    expect(stay?.explanation).toEqual({ code: "stay.dwell", params: { minutes: 90 } });
    expect(stay?.coverage).toBe("complete");
    expect(suggestion).toMatchObject({
      kind: "country",
      algorithm: { name: "country", version: 2 },
      status: "pending",
      coverage: "truncated",
    });
  });
});

describe("explanations", () => {
  it("every new explanation has a code and scalar params", () => {
    expect(explanation("journey.unlogged", { km: 412, mode: "rail" })).toEqual({
      code: "journey.unlogged",
      params: { km: 412, mode: "rail" },
    });
    expect(() => explanation("", {})).toThrow();
    expect(() => explanation("Ein Satz mit Leerzeichen", {})).toThrow();
    expect(() =>
      explanation("x.y", { at: { lat: 1, lon: 2 } } as unknown as Record<string, number>)
    ).toThrow();
    expect(() => explanation("x.y", { n: Number.NaN })).toThrow();
  });

  it("a stored explanation outside that shape is not read as one", () => {
    expect(parseExplanation({ code: "x.y", params: { n: 1 } })).toEqual({
      code: "x.y",
      params: { n: 1 },
    });
    expect(parseExplanation({ code: "x.y", params: { at: [1, 2] } })).toBeNull();
    expect(parseExplanation({ params: {} })).toBeNull();
    expect(parseExplanation("Aufenthalt in Seoul")).toBeNull();
  });
});
