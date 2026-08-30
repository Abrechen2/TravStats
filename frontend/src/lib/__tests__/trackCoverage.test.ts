import { describe, expect, it } from "vitest";
import { findCoveringTrackId, trackCoversLeg } from "../trackCoverage";

// A short north-south track near Kristiansand, roughly matching the
// anchor points used below.
const TRACK: Array<[number, number]> = [
  [8.0, 58.15],
  [8.05, 58.2],
  [8.1, 58.3],
  [7.9, 60.0],
];

describe("trackCoversLeg", () => {
  it("covers a leg whose both stops sit within the anchor tolerance", () => {
    const from = { lat: 58.15, lon: 8.0 };
    const to = { lat: 60.0, lon: 7.9 };
    expect(trackCoversLeg(TRACK, from, to)).toBe(true);
  });

  it("does not cover a leg whose stop is far from every point in the track", () => {
    const from = { lat: 58.15, lon: 8.0 };
    const to = { lat: 45.0, lon: 12.0 }; // far away — a different day entirely
    expect(trackCoversLeg(TRACK, from, to)).toBe(false);
  });

  it("does not cover a leg when only ONE of the two stops is within tolerance", () => {
    const from = { lat: 58.15, lon: 8.0 }; // close
    const to = { lat: 10.0, lon: 10.0 }; // far
    expect(trackCoversLeg(TRACK, from, to)).toBe(false);
  });

  it("never covers anything for a track with fewer than two points", () => {
    const single: Array<[number, number]> = [[8.0, 58.15]];
    expect(trackCoversLeg(single, { lat: 58.15, lon: 8.0 }, { lat: 58.15, lon: 8.0 })).toBe(false);
    expect(trackCoversLeg([], { lat: 58.15, lon: 8.0 }, { lat: 58.15, lon: 8.0 })).toBe(false);
  });

  it("respects a custom anchor tolerance", () => {
    const from = { lat: 58.15, lon: 8.0 };
    const to = { lat: 58.3, lon: 8.12 }; // ~5-10km from the nearest track point
    expect(trackCoversLeg(TRACK, from, to, 1)).toBe(false);
    expect(trackCoversLeg(TRACK, from, to, 50)).toBe(true);
  });
});

describe("findCoveringTrackId", () => {
  const from = { lat: 58.15, lon: 8.0 };
  const to = { lat: 60.0, lon: 7.9 };

  it("returns undefined when no track covers the leg", () => {
    expect(findCoveringTrackId([{ id: "t1", geometry: TRACK }], { lat: 45, lon: 12 }, to)).toBe(
      undefined
    );
  });

  it("returns the id of a single covering track", () => {
    expect(findCoveringTrackId([{ id: "t1", geometry: TRACK }], from, to)).toBe("t1");
  });

  it("returns the FIRST covering track when several qualify — order is the caller's choice", () => {
    const other: Array<[number, number]> = [
      [8.0, 58.15],
      [7.9, 60.0],
    ];
    expect(
      findCoveringTrackId(
        [
          { id: "later", geometry: other },
          { id: "earlier", geometry: TRACK },
        ],
        from,
        to
      )
    ).toBe("later");
  });
});
