import {
  clusterPhotosByTime,
  distanceKm,
  findUncoveredClusters,
  type PhotoCluster,
  type ScanPhoto,
} from "./cluster";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const START = Date.UTC(2026, 4, 1, 9, 0, 0);

const photo = (
  id: string,
  offsetMs: number,
  position?: { lat: number; lon: number },
): ScanPhoto => ({
  id,
  takenAtMs: START + offsetMs,
  lat: position?.lat ?? null,
  lon: position?.lon ?? null,
});

const OPTIONS = { gapHours: 48, minPhotos: 4 };

describe("grouping photos into journeys", () => {
  it("keeps a burst together", () => {
    const clusters = clusterPhotosByTime(
      [0, HOUR, 2 * HOUR, 3 * HOUR].map((offset, i) => photo(`p${i}`, offset)),
      OPTIONS,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoCount).toBe(4);
  });

  it("splits on a long pause", () => {
    const clusters = clusterPhotosByTime(
      [
        ...[0, HOUR, 2 * HOUR, 3 * HOUR].map((o, i) => photo(`a${i}`, o)),
        ...[10 * DAY, 10 * DAY + HOUR, 10 * DAY + 2 * HOUR, 10 * DAY + 3 * HOUR].map(
          (o, i) => photo(`b${i}`, o),
        ),
      ],
      OPTIONS,
    );
    expect(clusters).toHaveLength(2);
  });

  it("drops a run too small to be a journey", () => {
    // Three photos on a Tuesday is lunch, not a trip.
    expect(
      clusterPhotosByTime(
        [0, HOUR, 2 * HOUR].map((o, i) => photo(`p${i}`, o)),
        OPTIONS,
      ),
    ).toHaveLength(0);
  });

  it("sorts before it groups", () => {
    // Immich pages newest-first, so a caller that concatenates pages hands
    // over a sequence that is only locally ordered. Clustering that as-is
    // produces one bogus cluster per page boundary.
    const ordered = [0, HOUR, 2 * HOUR, 3 * HOUR].map((o, i) =>
      photo(`p${i}`, o),
    );
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]];
    expect(clusterPhotosByTime(shuffled, OPTIONS)).toHaveLength(1);
  });

  it("ignores photos with no capture time", () => {
    // Downloads and messenger images report 0, and one of them would
    // anchor a cluster in 1970 and swallow the whole library into it.
    const clusters = clusterPhotosByTime(
      [
        { id: "junk", takenAtMs: 0, lat: null, lon: null },
        ...[0, HOUR, 2 * HOUR, 3 * HOUR].map((o, i) => photo(`p${i}`, o)),
      ],
      OPTIONS,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoIds).not.toContain("junk");
  });
});

describe("where a journey happened", () => {
  const LISBON = { lat: 38.72, lon: -9.14 };
  const FRANKFURT = { lat: 50.03, lon: 8.57 };

  it("reports the place most of the photos are, not the average", () => {
    // Three photos at the departure airport and five at the destination.
    // A mean would land in the Bay of Biscay, which nobody visited and
    // which reverse-geocodes to open water.
    const cluster = clusterPhotosByTime(
      [
        photo("d0", 0, FRANKFURT),
        photo("d1", HOUR, FRANKFURT),
        photo("d2", 2 * HOUR, FRANKFURT),
        photo("a0", 5 * HOUR, LISBON),
        photo("a1", 6 * HOUR, LISBON),
        photo("a2", 7 * HOUR, LISBON),
        photo("a3", 8 * HOUR, LISBON),
        photo("a4", 9 * HOUR, LISBON),
      ],
      OPTIONS,
    )[0];

    expect(cluster.position).not.toBeNull();
    expect(distanceKm(cluster.position!, LISBON)).toBeLessThan(50);
  });

  it("counts photos without coordinates but does not let them move it", () => {
    const cluster = clusterPhotosByTime(
      [
        photo("p0", 0, LISBON),
        photo("p1", HOUR, LISBON),
        photo("p2", 2 * HOUR),
        photo("p3", 3 * HOUR),
      ],
      OPTIONS,
    )[0];

    expect(cluster.photoCount).toBe(4);
    expect(cluster.locatedCount).toBe(2);
    expect(distanceKm(cluster.position!, LISBON)).toBeLessThan(1);
  });

  it("has no position when nothing carried one", () => {
    // Common on Android exports and anything stripped by a messenger.
    // Null, not (0,0) — that is a real place in the Atlantic.
    const cluster = clusterPhotosByTime(
      [0, HOUR, 2 * HOUR, 3 * HOUR].map((o, i) => photo(`p${i}`, o)),
      OPTIONS,
    )[0];
    expect(cluster.position).toBeNull();
    expect(cluster.locatedCount).toBe(0);
  });
});

describe("which journeys nobody recorded", () => {
  const cluster = (startOffset: number, endOffset: number): PhotoCluster => ({
    startMs: START + startOffset,
    endMs: START + endOffset,
    photoIds: ["x"],
    photoCount: 8,
    position: { lat: 38.72, lon: -9.14 },
    locatedCount: 8,
  });

  const window = (startOffset: number, endOffset: number) => ({
    startMs: START + startOffset,
    endMs: START + endOffset,
  });

  it("keeps a cluster with nothing recorded near it", () => {
    expect(
      findUncoveredClusters([cluster(0, 2 * DAY)], [window(60 * DAY, 62 * DAY)], {
        padDays: 3,
      }),
    ).toHaveLength(1);
  });

  it("drops one that a recorded trip explains", () => {
    expect(
      findUncoveredClusters([cluster(0, 2 * DAY)], [window(0, 2 * DAY)], {
        padDays: 3,
      }),
    ).toHaveLength(0);
  });

  it("forgives the days around a trip", () => {
    // The taxi, the terminal, the evening before. Without the slack every
    // real trip also produces a phantom cluster on each side of itself,
    // and the feature spends its credibility on journeys already recorded.
    expect(
      findUncoveredClusters(
        [cluster(-2 * DAY, -1 * DAY)],
        [window(0, 2 * DAY)],
        { padDays: 3 },
      ),
    ).toHaveLength(0);
  });

  it("treats an overlap as explained, not only containment", () => {
    // A fortnight of photos that begins on the day of a recorded flight
    // IS that flight's trip, even if the flight is one afternoon of it.
    expect(
      findUncoveredClusters([cluster(0, 14 * DAY)], [window(0, 1 * DAY)], {
        padDays: 3,
      }),
    ).toHaveLength(0);
  });

  it("keeps a cluster that only just misses the slack", () => {
    expect(
      findUncoveredClusters(
        [cluster(-10 * DAY, -9 * DAY)],
        [window(0, 2 * DAY)],
        { padDays: 3 },
      ),
    ).toHaveLength(1);
  });

  it("explains everything when the user has recorded nothing... by not explaining any of it", () => {
    expect(
      findUncoveredClusters([cluster(0, 2 * DAY)], [], { padDays: 3 }),
    ).toHaveLength(1);
  });
});

describe("distance", () => {
  it("measures a known pair", () => {
    // Frankfurt to Lisbon is about 1870 km.
    const km = distanceKm({ lat: 50.03, lon: 8.57 }, { lat: 38.72, lon: -9.14 });
    expect(km).toBeGreaterThan(1800);
    expect(km).toBeLessThan(1950);
  });

  it("is zero for a point against itself", () => {
    expect(distanceKm({ lat: 38.72, lon: -9.14 }, { lat: 38.72, lon: -9.14 })).toBe(
      0,
    );
  });
});
