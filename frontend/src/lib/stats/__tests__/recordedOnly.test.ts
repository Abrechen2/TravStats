import { afterEach, describe, expect, it } from "vitest";

import { setRecordedOnly, wantsRecordedOnly } from "../recordedOnly";

describe("recorded-only switch", () => {
  afterEach(() => setRecordedOnly(false));

  it("adds nothing while it is off", () => {
    expect(wantsRecordedOnly("get", "/stats/summary")).toBe(false);
  });

  it("marks reads of the routes the statistics page uses, and only reads", () => {
    setRecordedOnly(true);
    for (const url of ["/stats/summary", "/flights", "/rail", "/lodging/stays", "/trips?x=1"]) {
      expect(wantsRecordedOnly("GET", url)).toBe(true);
    }
    expect(wantsRecordedOnly("post", "/flights")).toBe(false);
    expect(wantsRecordedOnly("get", "/auth/me")).toBe(false);
    expect(wantsRecordedOnly("get", "/flightsX")).toBe(false);
  });
});
