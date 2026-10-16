import { describe, expect, it } from "vitest";

import { suggestedTripName } from "../tripSuggestionCopy";

const NS = "dataQuality:inbox.tripSuggestions";

describe("suggestedTripName", () => {
  const t = (key: string) => key;

  it("names destination and month in the reader's language", () => {
    expect(suggestedTripName({ destination: "Rom", startDay: "2025-05-03" }, "de", t)).toBe(
      "Rom · Mai 2025"
    );
    expect(suggestedTripName({ destination: "Rome", startDay: "2025-05-03" }, "en", t)).toBe(
      "Rome · May 2025"
    );
  });

  it("invents no place when there is no destination", () => {
    expect(suggestedTripName({ destination: null, startDay: "2025-12-31" }, "de", t)).toBe(
      `${NS}.nameFallback · Dezember 2025`
    );
  });
});
