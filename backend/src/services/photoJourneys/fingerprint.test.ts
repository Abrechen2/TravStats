import type { PhotoCluster } from "./cluster";
import { journeyFingerprint, visitFingerprint } from "./fingerprint";

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

describe("naming a visit stop so a re-scan recognises it (forgejo#211)", () => {
  // Gyeongbokgung and Bukchon: a kilometre apart, photographed the same
  // afternoon. Under the journey key (a day, 11 km) they are ONE key, and the
  // second stop would overwrite the first every night.
  const palace = cluster({
    startMs: Date.UTC(2026, 4, 1, 5, 10),
    endMs: Date.UTC(2026, 4, 1, 6, 0),
    position: { lat: 37.5796, lon: 126.977 },
  });
  const hanok = cluster({
    startMs: Date.UTC(2026, 4, 1, 7, 30),
    endMs: Date.UTC(2026, 4, 1, 8, 0),
    position: { lat: 37.5826, lon: 126.9833 },
  });

  it("tells two stops of one afternoon apart, which the journey key cannot", () => {
    expect(journeyFingerprint(palace)).toBe(journeyFingerprint(hanok));
    expect(visitFingerprint(palace)).not.toBe(visitFingerprint(hanok));
  });

  it("survives the rest of the stop's photos arriving", () => {
    const after = cluster({
      ...palace,
      endMs: Date.UTC(2026, 4, 1, 6, 40),
      photoCount: 30,
      position: { lat: 37.5799, lon: 126.9772 },
    });
    expect(visitFingerprint(after)).toBe(visitFingerprint(palace));
  });

  it("never collides with a journey key", () => {
    expect(visitFingerprint(palace)).toMatch(/^visit\|/);
    expect(journeyFingerprint(palace)).not.toMatch(/^visit\|/);
  });
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
      })
    );
    expect(after).toBe(before);
  });

  it("separates two journeys to different places on the same day", () => {
    expect(journeyFingerprint(cluster())).not.toBe(
      journeyFingerprint(cluster({ position: { lat: 52.52, lon: 13.4 } }))
    );
  });

  it("separates the same place on different days", () => {
    expect(journeyFingerprint(cluster())).not.toBe(
      journeyFingerprint(cluster({ startMs: Date.UTC(2026, 4, 1) + 40 * DAY }))
    );
  });

  it("does not move when the time of day changes", () => {
    // The first photo of a trip is whichever one you happened to take
    // first; an earlier one arriving later must not rename the journey.
    expect(journeyFingerprint(cluster({ startMs: Date.UTC(2026, 4, 1, 6, 0, 0) }))).toBe(
      journeyFingerprint(cluster({ startMs: Date.UTC(2026, 4, 1, 23, 0, 0) }))
    );
  });

  it("names a cluster with no position without pretending it has one", () => {
    // Not (0,0) — that is a real place in the Gulf of Guinea, and every
    // location-less journey would collide there.
    const key = journeyFingerprint(cluster({ position: null }));
    expect(key).toContain("nowhere");
    expect(key).not.toContain("0.0,0.0");
  });
});
