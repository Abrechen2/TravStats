import { chronologyProblem, departsInFuture } from "../flightChronology";

/**
 * Two wall-clock strings from two different clocks cannot be ordered.
 *
 * Chronology was a lexicographic comparison of `departureLocal` against
 * `arrivalLocal`, and the IANA zones sitting right beside them — which
 * `requirePairedTimezone` has always demanded — were never consulted. It was
 * wrong in both directions (audit finding AUD-018): ordinary westward flights
 * were refused, and a flight that genuinely went backwards in time was stored.
 *
 * The positive cases come first in each group. A rule that refuses everything
 * would satisfy the "must be rejected" half on its own.
 */
describe("flight chronology", () => {
  const utc = { depTimeSemantics: "UTC", arrTimeSemantics: "UTC" };

  describe("accepts a flight that really does arrive later", () => {
    it("westward: Central Europe 10:00 to London 09:45", () => {
      // 45 minutes in the air. The strings say the arrival is earlier.
      expect(
        chronologyProblem({
          departureLocal: "2026-06-01T10:00",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-06-01T09:45",
          arrTimezone: "Europe/London",
          ...utc,
        }),
      ).toBeNull();
    });

    it("backwards across the date line: Tokyo 20:00 to Honolulu 08:00 the same day", () => {
      expect(
        chronologyProblem({
          departureLocal: "2026-06-01T20:00",
          depTimezone: "Asia/Tokyo",
          arrivalLocal: "2026-06-01T08:00",
          arrTimezone: "Pacific/Honolulu",
          ...utc,
        }),
      ).toBeNull();
    });

    it("eastward overnight: Frankfurt 22:00 to Singapore 16:00 next day", () => {
      expect(
        chronologyProblem({
          departureLocal: "2026-06-01T22:00",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-06-02T16:00",
          arrTimezone: "Asia/Singapore",
          ...utc,
        }),
      ).toBeNull();
    });

    it("across a DST change", () => {
      // Europe/Berlin springs forward 2026-03-29 02:00 -> 03:00.
      expect(
        chronologyProblem({
          departureLocal: "2026-03-29T01:30",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-03-29T03:30",
          arrTimezone: "Europe/Berlin",
          ...utc,
        }),
      ).toBeNull();
    });
  });

  describe("refuses a flight that arrives before it departs", () => {
    it("eastward: London 10:00 to Berlin 10:30 is minus thirty minutes", () => {
      // The exact row the audit stored: 10:00Z in, 09:30Z out.
      const problem = chronologyProblem({
        departureLocal: "2026-06-01T10:00",
        depTimezone: "Europe/London",
        arrivalLocal: "2026-06-01T10:30",
        arrTimezone: "Europe/Berlin",
        ...utc,
      });

      expect(problem).not.toBeNull();
      expect(problem?.path).toBe("arrivalLocal");
    });

    it("same zone, arrival earlier in the day", () => {
      expect(
        chronologyProblem({
          departureLocal: "2026-06-01T15:00",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-06-01T14:00",
          arrTimezone: "Europe/Berlin",
          ...utc,
        }),
      ).not.toBeNull();
    });
  });

  describe("DATE_ONLY rows are compared by day, deliberately", () => {
    it("accepts a same-day round trip whose placeholders shifted", () => {
      // The 12:00 placeholder is converted by airport zone, so its clock time
      // means nothing — only the day can be compared.
      expect(
        chronologyProblem({
          departureLocal: "2026-06-01T12:00",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-06-01T12:00",
          arrTimezone: "America/New_York",
          depTimeSemantics: "DATE_ONLY",
          arrTimeSemantics: "DATE_ONLY",
        }),
      ).toBeNull();
    });

    it("still refuses an arrival on an earlier day", () => {
      expect(
        chronologyProblem({
          departureLocal: "2026-06-02T12:00",
          depTimezone: "Europe/Berlin",
          arrivalLocal: "2026-06-01T12:00",
          arrTimezone: "Europe/Berlin",
          depTimeSemantics: "DATE_ONLY",
          arrTimeSemantics: "DATE_ONLY",
        }),
      ).not.toBeNull();
    });
  });

  it("has nothing to say when a side is missing", () => {
    expect(chronologyProblem({ departureLocal: "2026-06-01T10:00", depTimezone: "UTC" })).toBeNull();
    expect(chronologyProblem({})).toBeNull();
  });

  describe("a flight already taken cannot depart in the future", () => {
    const now = new Date("2026-06-01T12:00:00Z");

    it("does not call a flight that just left Tokyo a future one", () => {
      // 20:30 Tokyo on 1 June is 11:30Z — half an hour ago. The string
      // comparison read it as eight and a half hours ahead.
      expect(departsInFuture("2026-06-01T20:30", "Asia/Tokyo", now)).toBe(false);
    });

    it("still catches a departure that genuinely has not happened", () => {
      expect(departsInFuture("2026-06-02T20:30", "Asia/Tokyo", now)).toBe(true);
    });
  });
});
