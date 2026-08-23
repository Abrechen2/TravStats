import type { PhotoCluster } from "./cluster";
import { journeyFingerprint } from "./fingerprint";

const DAY = 86_400_000;

const cluster = (over: Partial<PhotoCluster> = {}): PhotoCluster => ({
  startMs: Date.UTC(2026, 4, 1, 9, 0, 0),
  endMs: Date.UTC(2026, 4, 3, 18, 0, 0),
  photoIds: ["a", "b", "c", "d"],
  photoCount: 4,
  position: { lat: 38.72, lon: -9.14 },
  locatedCount: 4,
  ...over,
});

describe("naming a journey so a re-scan recognises it", () => {
  it("is the same for the same journey", () => {
    expect(journeyFingerprint(cluster())).toBe(journeyFingerprint(cluster()));
  });

  it("survives more photos arriving", () => {
    // Importing the rest of a holiday extends the end and nudges the
    // median. If the key moved with it, the user would be asked about
    // the same trip again — and again after the next import.
    const before = journeyFingerprint(cluster());
    const after = journeyFingerprint(
      cluster({
        endMs: Date.UTC(2026, 4, 6, 18, 0, 0),
        photoCount: 40,
        position: { lat: 38.74, lon: -9.11 },
      }),
    );
    expect(after).toBe(before);
  });

  it("separates two journeys to different places on the same day", () => {
    expect(journeyFingerprint(cluster())).not.toBe(
      journeyFingerprint(cluster({ position: { lat: 52.52, lon: 13.4 } })),
    );
  });

  it("separates the same place on different days", () => {
    expect(journeyFingerprint(cluster())).not.toBe(
      journeyFingerprint(
        cluster({ startMs: Date.UTC(2026, 4, 1) + 40 * DAY }),
      ),
    );
  });

  it("does not move when the time of day changes", () => {
    // The first photo of a trip is whichever one you happened to take
    // first; an earlier one arriving later must not rename the journey.
    expect(
      journeyFingerprint(cluster({ startMs: Date.UTC(2026, 4, 1, 6, 0, 0) })),
    ).toBe(journeyFingerprint(cluster({ startMs: Date.UTC(2026, 4, 1, 23, 0, 0) })));
  });

  it("names a cluster with no position without pretending it has one", () => {
    // Not (0,0) — that is a real place in the Gulf of Guinea, and every
    // location-less journey would collide there.
    const key = journeyFingerprint(cluster({ position: null }));
    expect(key).toContain("nowhere");
    expect(key).not.toContain("0.0,0.0");
  });
});
