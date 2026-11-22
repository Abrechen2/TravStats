import { describe, expect, it } from "vitest";
import { isPlannedOnly, lodgingPresence, mapStatusClass } from "../mapPresence";

const NOW = new Date("2026-06-01T12:00:00Z");
const stay = (status: string, checkIn: string, checkOut: string) => ({ status, checkIn, checkOut });

describe("mapStatusClass", () => {
  it("hides a cancelled entry, marks a scheduled one planned and keeps the rest visited", () => {
    expect(mapStatusClass("cancelled")).toBe("hidden");
    expect(mapStatusClass("scheduled")).toBe("planned");
    for (const s of ["flown", "historical", "completed", "in_progress", "duplicated"]) {
      expect(mapStatusClass(s)).toBe("visited");
    }
  });
});

describe("isPlannedOnly", () => {
  it("is true only with planned entries and nothing that happened", () => {
    expect(isPlannedOnly({ visited: 0, planned: 2 })).toBe(true);
    expect(isPlannedOnly({ visited: 1, planned: 2 })).toBe(false);
    expect(isPlannedOnly({ visited: 0, planned: 0 })).toBe(false);
  });
});

describe("lodgingPresence (counts only after check-out, via lodgingCounting)", () => {
  it("is planned for a house with only a future stay", () => {
    const p = lodgingPresence({ stays: [stay("confirmed", "2026-09-01", "2026-09-05")] }, NOW);
    expect(p.class).toBe("planned");
    expect(p.counts).toEqual({ visited: 0, planned: 1 });
  });
  it("is visited, with the planned count alongside, for a mixed house", () => {
    const p = lodgingPresence(
      {
        stays: [
          stay("confirmed", "2025-01-01", "2025-01-05"),
          stay("confirmed", "2026-09-01", "2026-09-05"),
        ],
      },
      NOW
    );
    expect(p.class).toBe("visited");
    expect(p.counts).toEqual({ visited: 1, planned: 1 });
  });
  it("hides a house whose every stay is cancelled", () => {
    const p = lodgingPresence({ stays: [stay("cancelled", "2026-09-01", "2026-09-05")] }, NOW);
    expect(p.class).toBe("hidden");
  });
});
