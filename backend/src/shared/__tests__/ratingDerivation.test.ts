import { deriveStayOverallRating } from "../ratingDerivation";

describe("deriveStayOverallRating", () => {
  it("averages the three components and rounds to the nearest half star", () => {
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: 3 })).toBe(4);
    // 4.166… -> 4 ; 4.333… -> 4.5
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: 3.5 })).toBe(4);
    expect(deriveStayOverallRating({ room: 5, breakfast: 4.5, service: 4.5 })).toBe(4.5);
  });

  it("averages only the components that were given", () => {
    expect(deriveStayOverallRating({ room: 4, breakfast: null, service: null })).toBe(4);
    // The shape of Alex's real sheet: room + breakfast, no service, no overall.
    expect(deriveStayOverallRating({ room: 4, breakfast: 5, service: null })).toBe(4.5);
  });

  it("derives from the components even when the source also carried an overall", () => {
    // A hand-typed or imported overall must never contradict the components —
    // that contradiction is the reason the overall stopped being an input.
    expect(deriveStayOverallRating({ room: 5, breakfast: 5, service: 5, current: 2 })).toBe(5);
  });

  it("keeps an explicit overall when no component rating exists", () => {
    // A source that scores the stay as a whole (a Booking.com score, a legacy
    // row) is the user's own data with nothing to contradict it. Dropping it
    // would be a silent loss, so it survives as the fallback.
    expect(deriveStayOverallRating({ room: null, breakfast: null, service: null, current: 4 })).toBe(4);
  });

  it("is null when the stay carries no rating at all", () => {
    expect(deriveStayOverallRating({ room: null, breakfast: null, service: null })).toBeNull();
    expect(
      deriveStayOverallRating({ room: null, breakfast: null, service: null, current: null })
    ).toBeNull();
  });
});
