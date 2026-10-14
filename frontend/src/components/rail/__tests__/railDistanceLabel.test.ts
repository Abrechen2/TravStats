import { describe, expect, it } from "vitest";
import { railDistanceNoteKey } from "../railDistanceLabel";

describe("route distance attribution", () => {
  it.each([
    ["transitous", "rail:tracedLine"],
    ["openrailrouting", "rail:routedLine"],
    [null, "rail:alongLine"],
    ["unknown", "rail:alongLine"],
  ])("labels %s without inventing a provider", (geometrySource, label) => {
    expect(railDistanceNoteKey("route", { geometrySource })).toBe(label);
  });
  it("preserves the ticket label even when a routed geometry exists", () => {
    expect(
      railDistanceNoteKey("user", { includeTicket: true, geometrySource: "openrailrouting" })
    ).toBe("rail:detail.typedDistance");
  });
});
