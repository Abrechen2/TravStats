import { describe, expect, it } from "vitest";
import { deriveStayOverallRating } from "../ratingDerivation";

/**
 * The SAME truth table as `backend/src/shared/__tests__/ratingDerivation.test.ts`.
 * The editor must predict exactly the number the server is about to store, so
 * these two suites disagreeing is the failure this mirror exists to catch.
 */
describe("deriveStayOverallRating", () => {
  it("averages the three components and rounds to the nearest half star", () => {
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: 3 })).toBe(4);
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: 3.5 })).toBe(4);
    expect(deriveStayOverallRating({ room: 5, breakfast: 4.5, service: 4.5 })).toBe(4.5);
  });

  it("averages only the components that were given", () => {
    expect(deriveStayOverallRating({ room: 4, breakfast: null, service: null })).toBe(4);
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: null })).toBe(4.5);
  });

  it("derives from the components even when the source also carried an overall", () => {
    expect(deriveStayOverallRating({ room: 5, breakfast: 5, service: 5, current: 2 })).toBe(5);
  });

  it("keeps an explicit overall when no component rating exists", () => {
    expect(deriveStayOverallRating({ room: null, breakfast: null, service: null, current: 4 })).toBe(4);
  });

  it("is null when the stay carries no rating at all", () => {
    expect(deriveStayOverallRating({ room: null, breakfast: null, service: null })).toBeNull();
    expect(
      deriveStayOverallRating({ room: null, breakfast: null, service: null, current: null })
    ).toBeNull();
  });
});
