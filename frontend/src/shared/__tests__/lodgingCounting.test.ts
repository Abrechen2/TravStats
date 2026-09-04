import { describe, it, expect } from "vitest";
import { classifyLodging, classifyStay, isVisited, countsAsLodging } from "../lodgingCounting";

/**
 * MIRROR of `backend/src/shared/__tests__/lodgingCounting.test.ts` — the same
 * truth table, asserted on the client copy. Change the rules on one side only
 * and one of the two suites goes red, which is the whole point of mirroring.
 */
const NOW = new Date("2026-08-15T12:00:00Z");
const d = (iso: string): Date => new Date(iso);

describe("classifyStay", () => {
  it("counts a stay whose check-out is past as visited", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-10"), checkOut: d("2026-08-12") },
        NOW
      )
    ).toBe("visited");
  });

  it("counts a future booking as planned, never as visited", () => {
    expect(
      classifyStay(
        { status: "scheduled", checkIn: d("2026-09-01"), checkOut: d("2026-09-05") },
        NOW
      )
    ).toBe("planned");
  });

  it("counts a stay still running as planned — the rule is 'until the check-out is past'", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-14"), checkOut: d("2026-08-20") },
        NOW
      )
    ).toBe("planned");
  });

  it("excludes a cancelled stay whatever its dates say", () => {
    expect(
      classifyStay(
        { status: "cancelled", checkIn: d("2020-01-01"), checkOut: d("2020-01-05") },
        NOW
      )
    ).toBe("excluded");
  });

  it("reads the dates, not a stale status column", () => {
    expect(
      classifyStay(
        { status: "scheduled", checkIn: d("2024-03-01"), checkOut: d("2024-03-04") },
        NOW
      )
    ).toBe("visited");
  });

  it("counts a same-day check-in/check-out that is past as visited", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-14"), checkOut: d("2026-08-14") },
        NOW
      )
    ).toBe("visited");
  });

  it("falls back to planned for a dateless stay rather than inventing a visit", () => {
    expect(classifyStay({ status: "scheduled", checkIn: null, checkOut: null }, NOW)).toBe(
      "planned"
    );
  });
});

describe("classifyLodging", () => {
  it("excludes a house that is only noted down, however many stays it has", () => {
    expect(classifyLodging({ visited: false }, ["visited"])).toBe("excluded");
  });

  it("counts a house with a finished stay as visited", () => {
    expect(classifyLodging({ visited: true }, ["planned", "visited"])).toBe("visited");
  });

  it("counts a house whose only stays lie ahead as planned", () => {
    expect(classifyLodging({ visited: true }, ["planned", "planned"])).toBe("planned");
  });

  // forgejo#80: mirror of the backend rule — the house counts, the place does not.
  it("marks a stay-less house asserted — countable as a house, proving no place", () => {
    expect(classifyLodging({ visited: true }, [])).toBe("asserted");
    expect(countsAsLodging("asserted")).toBe(true);
    expect(isVisited("asserted")).toBe(false);
  });

  it("marks a house whose only stay was cancelled asserted — the house was not cancelled", () => {
    expect(classifyLodging({ visited: true }, ["excluded"])).toBe("asserted");
  });
});

describe("isVisited", () => {
  it("is true only for the visited state", () => {
    expect(isVisited("visited")).toBe(true);
    expect(isVisited("planned")).toBe(false);
    expect(isVisited("excluded")).toBe(false);
  });
});
