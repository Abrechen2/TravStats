import { judgeEvent } from "../judge";

/**
 * The diagnostics log carries no position (spec 2026-10-29, "Per event"):
 * Codex found that a key blacklist alone lets a fix id or a note's free text
 * through, so these pin the typed values that hold it instead.
 */

const NOW = Date.parse("2026-10-29T12:00:00Z");
const at = (data: unknown, extra: object = {}) =>
  judgeEvent({ t: "2026-10-29T11:00:00.000Z", kind: "fixes", data, ...extra }, NOW);

describe("judgeEvent", () => {
  it("takes identifiers, two-decimal numbers, booleans, null and integer counts", () => {
    const judged = at({
      received: 60,
      kept: 58,
      battery: 0.45,
      lowPower: false,
      error: null,
      status: "whenInUse",
      dropped: { interval: 2 },
    });
    expect(judged).toMatchObject({
      kind: "fixes",
      data: { battery: 0.45, dropped: { interval: 2 } },
    });
  });

  it.each([
    ["a coordinate under an innocent key", { foo: 48.13743 }],
    ["free text", { text: "Marienplatz 1, München" }],
    ["a fix id in a value", { ref: "1730203200000:48.137:11.575" }],
    ["nested objects", { a: { b: { c: 1 } } }],
    ["non-integer counts", { dropped: { interval: 1.5 } }],
    ["an array", [1, 2]],
  ])("refuses %s", (_label, data) => {
    expect(at(data)).toBe("data");
  });

  it.each(["lat", "Longitude", "fixId", "originRef", "location"])(
    "refuses the position key %s",
    (key) => {
      expect(at({ [key]: 1 })).toBe("coordinates");
    }
  );

  it("refuses an instant without a zone, older than 14 days or in the future", () => {
    expect(judgeEvent({ t: "2026-10-29T11:00:00", kind: "fixes" }, NOW)).toBe("time");
    expect(judgeEvent({ t: "2026-10-14T11:00:00Z", kind: "fixes" }, NOW)).toBe("time");
    expect(judgeEvent({ t: "2026-10-29T12:30:00Z", kind: "fixes" }, NOW)).toBe("time");
  });

  it("refuses a malformed kind and unknown envelope fields", () => {
    expect(judgeEvent({ t: "2026-10-29T11:00:00Z", kind: "Fixes!" }, NOW)).toBe("kind");
    expect(at({}, { lat: 48.1 })).toBe("data");
  });

  it("stores any well-formed kind, so the app can add one without a server release", () => {
    expect(judgeEvent({ t: "2026-10-29T11:00:00Z", kind: "audio.session" }, NOW)).toMatchObject({
      kind: "audio.session",
      data: {},
    });
  });
});
