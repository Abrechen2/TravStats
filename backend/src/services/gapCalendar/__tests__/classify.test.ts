import { classifyDay, isInferred, countStates, toRuns, type DayFacts } from "../classify";

const none: DayFacts = { entries: 0, goodFixes: 0, homeFixes: 0, zoneFixes: 0, badFixes: 0 };

describe("gap calendar — classification precedence", () => {
  it("a day nothing explains is unknown, never zero-coverage 'track'", () => {
    expect(classifyDay(none)).toBe("unknown");
  });

  it("a silent day between two home fixes is home, but never over a fix or an entry", () => {
    expect(classifyDay({ ...none, silentHome: true })).toBe("home");
    expect(classifyDay({ ...none, silentHome: true, entries: 1 })).toBe("entry");
    expect(classifyDay({ ...none, silentHome: true, goodFixes: 2, homeFixes: 1 })).toBe("track");
  });

  it("a silent day at a known non-home place is `place`, inferred; home wins over it", () => {
    expect(classifyDay({ ...none, silentPlace: true })).toBe("place");
    expect(classifyDay({ ...none, silentPlace: true, silentHome: true })).toBe("home");
    expect(isInferred({ ...none, silentPlace: true })).toBe(true);
    expect(isInferred({ ...none, goodFixes: 2, homeFixes: 2 })).toBe(false);
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
