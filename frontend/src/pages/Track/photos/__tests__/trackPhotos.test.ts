import { describe, expect, it } from "vitest";
import { isNotConfigured, photoFailureKey, photoWindowOf } from "../trackPhotos";

const refused = (status: number, error: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: { error } } });

describe("trackPhotos", () => {
  it("asks for the recorded extent, nothing without a fix, and refuses over seven days", () => {
    const t = Date.parse("2026-10-25T06:00:00Z");
    expect(
      photoWindowOf([
        [
          [t, 1, 1, null],
          [t + 60_000, 1, 1, null],
        ],
        [[t + 120_000, 1, 1, null]],
      ])
    ).toEqual({
      kind: "window",
      window: { from: "2026-10-25T06:00:00.000Z", to: "2026-10-25T06:02:00.001Z" },
    });
    expect(photoWindowOf([[], []])).toEqual({ kind: "none" });
    expect(photoWindowOf([[[t, 1, 1, null]], [[t + 8 * 86_400_000, 1, 1, null]]])).toEqual({
      kind: "tooLong",
    });
  });

  it("maps every Immich kind to its own copy, and anything else to the generic reasons", () => {
    for (const kind of [
      "notConfigured",
      "unreachable",
      "auth",
      "notFound",
      "protocol",
      "invalidUrl",
    ]) {
      expect(photoFailureKey(refused(502, kind))).toBe(`track:photos.failure.${kind}`);
    }
    expect(isNotConfigured(photoFailureKey(refused(409, "notConfigured")))).toBe(true);
    expect(photoFailureKey(refused(500, "Something exploded"))).toBe("track:errors.generic");
    expect(photoFailureKey(new Error("offline"))).toBe("track:errors.network");
  });
});
