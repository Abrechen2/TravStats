import {
  classifyLodging,
  classifyStay,
  isVisited,
  type LodgingCountState,
} from "../lodgingCounting";

/**
 * Truth table for the owner rule of 2026-08-15. The frontend mirror
 * (`frontend/src/shared/__tests__/lodgingCounting.test.ts`) asserts the same
 * cases — if one side is changed alone, the two disagree here first.
 */
const NOW = new Date("2026-08-15T12:00:00Z");
const d = (iso: string): Date => new Date(iso);

describe("classifyStay", () => {
  it("counts a stay whose check-out is past as visited", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-10"), checkOut: d("2026-08-12") },
        NOW,
      ),
    ).toBe<LodgingCountState>("visited");
  });

  it("counts a future booking as planned, never as visited", () => {
    expect(
      classifyStay(
        { status: "scheduled", checkIn: d("2026-09-01"), checkOut: d("2026-09-05") },
        NOW,
      ),
    ).toBe<LodgingCountState>("planned");
  });

  it("counts a stay still running as planned — the rule is 'until the check-out is past'", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-14"), checkOut: d("2026-08-20") },
        NOW,
      ),
    ).toBe<LodgingCountState>("planned");
  });

  it("excludes a cancelled stay whatever its dates say", () => {
    expect(
      classifyStay(
        { status: "cancelled", checkIn: d("2020-01-01"), checkOut: d("2020-01-05") },
        NOW,
      ),
    ).toBe<LodgingCountState>("excluded");
  });

  it("reads the dates, not a stale status column", () => {
    // The sweep converges `status` hourly; between runs a long-past stay can
    // still say "scheduled". Trusting the column would drop it from every
    // figure until the next tick.
    expect(
      classifyStay(
        { status: "scheduled", checkIn: d("2024-03-01"), checkOut: d("2024-03-04") },
        NOW,
      ),
    ).toBe<LodgingCountState>("visited");
  });

  it("counts a same-day check-in/check-out that is past as visited", () => {
    expect(
      classifyStay(
        { status: "completed", checkIn: d("2026-08-14"), checkOut: d("2026-08-14") },
        NOW,
      ),
    ).toBe<LodgingCountState>("visited");
  });

  it("falls back to planned for a dateless stay rather than inventing a visit", () => {
    expect(
      classifyStay({ status: "scheduled", checkIn: null, checkOut: null }, NOW),
    ).toBe<LodgingCountState>("planned");
  });
});

describe("classifyLodging", () => {
  it("excludes a house that is only noted down, however many stays it has", () => {
    expect(classifyLodging({ visited: false }, ["visited"])).toBe<LodgingCountState>("excluded");
  });

  it("counts a house with a finished stay as visited", () => {
    expect(classifyLodging({ visited: true }, ["planned", "visited"])).toBe<LodgingCountState>(
      "visited",
    );
  });

  it("counts a house whose only stays lie ahead as planned", () => {
    expect(classifyLodging({ visited: true }, ["planned", "planned"])).toBe<LodgingCountState>(
      "planned",
    );
  });

  it("keeps a stay-less house countable — the user's own claim stands", () => {
    expect(classifyLodging({ visited: true }, [])).toBe<LodgingCountState>("visited");
  });

  it("excludes a house whose every stay was cancelled — the record says it did not happen", () => {
    // Owner's decision, 2026-09-02. This used to answer "visited": a list of
    // nothing but `excluded` fell through to the stay-less line, so CANCELLING
    // a booking proved a visit.
    expect(classifyLodging({ visited: true }, ["excluded"])).toBe<LodgingCountState>("excluded");
    expect(classifyLodging({ visited: true }, ["excluded", "excluded"])).toBe<LodgingCountState>(
      "excluded",
    );
  });

  it("tells 'no stay at all' apart from 'stays, all cancelled'", () => {
    // The pair that made the fall-through a bug: same empty result, opposite
    // meaning. Adding a house must never REMOVE it from the count, so the
    // stay-less house keeps counting.
    expect(classifyLodging({ visited: true }, [])).toBe<LodgingCountState>("visited");
    expect(classifyLodging({ visited: true }, ["excluded"])).toBe<LodgingCountState>("excluded");
  });

  it("still counts a house with one cancelled stay and one finished one", () => {
    expect(classifyLodging({ visited: true }, ["excluded", "visited"])).toBe<LodgingCountState>(
      "visited",
    );
  });

  it("still plans a house with one cancelled stay and one booking ahead", () => {
    expect(classifyLodging({ visited: true }, ["excluded", "planned"])).toBe<LodgingCountState>(
      "planned",
    );
  });
});

describe("isVisited", () => {
  it("is true only for the visited state", () => {
    expect(isVisited("visited")).toBe(true);
    expect(isVisited("planned")).toBe(false);
    expect(isVisited("excluded")).toBe(false);
  });
});
