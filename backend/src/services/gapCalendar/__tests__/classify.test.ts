import { classifyDay, countStates, toRuns, type DayFacts } from "../classify";

const none: DayFacts = { entries: 0, goodFixes: 0, homeFixes: 0, zoneFixes: 0, badFixes: 0 };

describe("gap calendar — classification precedence", () => {
  it("a day nothing explains is unknown, never zero-coverage 'track'", () => {
    expect(classifyDay(none)).toBe("unknown");
  });

  it("an entry outranks every fix-based state", () => {
    expect(classifyDay({ entries: 1, goodFixes: 9, homeFixes: 9, zoneFixes: 3, badFixes: 2 })).toBe(
      "entry"
    );
  });

  it("only home fixes make a home day; one fix elsewhere makes it a track day", () => {
    expect(classifyDay({ ...none, goodFixes: 4, homeFixes: 4 })).toBe("home");
    expect(classifyDay({ ...none, goodFixes: 4, homeFixes: 3 })).toBe("track");
  });

  it("a plausible fix outside the zones outranks zone and implausible fixes of the same day", () => {
    expect(classifyDay({ ...none, goodFixes: 1, zoneFixes: 5, badFixes: 5 })).toBe("track");
  });

  it("zone-hidden outranks implausible, implausible outranks unknown", () => {
    expect(classifyDay({ ...none, zoneFixes: 1, badFixes: 7 })).toBe("privacyZone");
    expect(classifyDay({ ...none, badFixes: 1 })).toBe("implausible");
  });

  it("runs merge neighbours of one state and count every day once", () => {
    const days = [
      { day: "2026-01-01", state: "unknown" as const },
      { day: "2026-01-02", state: "unknown" as const },
      { day: "2026-01-03", state: "entry" as const },
      { day: "2026-01-04", state: "unknown" as const },
    ];
    expect(toRuns(days)).toEqual([
      { from: "2026-01-01", to: "2026-01-02", state: "unknown" },
      { from: "2026-01-03", to: "2026-01-03", state: "entry" },
      { from: "2026-01-04", to: "2026-01-04", state: "unknown" },
    ]);
    expect(countStates(days)).toMatchObject({ unknown: 3, entry: 1, outside: 0 });
  });
});
