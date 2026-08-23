/**
 * Turning a photo library into candidate journeys.
 *
 * The idea is the one CountryTracker uses on a phone: photos carry a
 * timestamp and, often, a coordinate. A burst of them far from home, on
 * days with nothing recorded, is very likely a trip nobody wrote down.
 *
 * Doing it here rather than on the phone is a straight win. Immich already
 * holds the whole library with EXIF coordinates, so there is no upload, no
 * permission prompt, no 3000-photo cap, and no per-asset lookup over a
 * mobile connection. It also runs when nobody is looking at a screen.
 *
 * Everything in this file is pure. It takes plain photos and plain travel
 * windows and returns plain clusters — no Immich, no Prisma, no network —
 * so the judgement calls below can be argued with in a unit test rather
 * than against a live library.
 */

/** One photo, reduced to what the clustering actually needs. */
export interface ScanPhoto {
  id: string;
  /** Epoch milliseconds the photo was taken. */
  takenAtMs: number;
  lat: number | null;
  lon: number | null;
}

/** A run of photos with no long gap in it. */
export interface PhotoCluster {
  /** Epoch ms of the first and last photo. */
  startMs: number;
  endMs: number;
  photoIds: readonly string[];
  /** Every photo, including the ones without coordinates. */
  photoCount: number;
  /** Representative position, or null when no photo carried one. */
  position: { lat: number; lon: number } | null;
  /** How many photos actually carried a coordinate. */
  locatedCount: number;
}

/** A stretch of time already explained by something the user recorded. */
export interface TravelWindow {
  startMs: number;
  endMs: number;
}

export interface ClusterOptions {
  /** A pause longer than this starts a new cluster. */
  gapHours: number;
  /** Fewer photos than this is a moment, not a journey. */
  minPhotos: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Group photos into runs separated by a long pause.
 *
 * Sorted here rather than assumed: Immich pages by `fileCreatedAt`
 * descending, and a caller that concatenates pages hands over a sequence
 * that is only locally ordered. Clustering an unsorted list silently
 * produces one cluster per page boundary.
 */
export function clusterPhotosByTime(
  photos: readonly ScanPhoto[],
  { gapHours, minPhotos }: ClusterOptions,
): PhotoCluster[] {
  const usable = photos
    // A photo with no capture time is a download or a screenshot as often
    // as it is a memory, and it would anchor a cluster in 1970.
    .filter((photo) => Number.isFinite(photo.takenAtMs) && photo.takenAtMs > 0)
    .sort((a, b) => a.takenAtMs - b.takenAtMs);

  const gapMs = gapHours * HOUR_MS;
  const runs: ScanPhoto[][] = [];
  for (const photo of usable) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (previous === undefined || photo.takenAtMs - previous.takenAtMs > gapMs) {
      runs.push([photo]);
      continue;
    }
    current.push(photo);
  }

  return runs
    .filter((run) => run.length >= minPhotos)
    .map((run) => toCluster(run));
}

function toCluster(run: readonly ScanPhoto[]): PhotoCluster {
  const located = run.filter(
    (photo): photo is ScanPhoto & { lat: number; lon: number } =>
      typeof photo.lat === "number" &&
      typeof photo.lon === "number" &&
      Number.isFinite(photo.lat) &&
      Number.isFinite(photo.lon),
  );

  return {
    startMs: run[0].takenAtMs,
    endMs: run[run.length - 1].takenAtMs,
    photoIds: run.map((photo) => photo.id),
    photoCount: run.length,
    position: representativePosition(located),
    locatedCount: located.length,
  };
}

/**
 * Where the cluster "is", as one coordinate.
 *
 * The MEDIAN of each axis, not the mean: a trip that begins with three
 * photos at the departure airport and continues with forty at the
 * destination should report the destination. An average would place it
 * somewhere over the sea between them, which is a coordinate nobody
 * visited and which reverse-geocodes to nothing.
 *
 * Taking the axes independently can, for a cluster spread over a very
 * large area, name a point that is not any single photo. That is
 * acceptable: it stays inside the cluster's bounding box, and clusters
 * that large are journeys whose "one country" answer was always going to
 * be an approximation.
 */
function representativePosition(
  located: readonly { lat: number; lon: number }[],
): { lat: number; lon: number } | null {
  if (located.length === 0) {
    return null;
  }
  return {
    lat: median(located.map((photo) => photo.lat)),
    lon: median(located.map((photo) => photo.lon)),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Clusters that no recorded travel explains.
 *
 * `padDays` is slack on both sides of every known window, because the
 * photos of a trip start before the plane does — the taxi, the terminal,
 * the evening before — and continue after it lands. Without the padding
 * every real trip also produces a small phantom cluster on either side of
 * itself, and the feature spends its credibility telling the user about
 * journeys they already recorded.
 *
 * A cluster counts as explained by any OVERLAP, not by containment: a
 * fortnight of photos that begins on the day of a recorded flight is that
 * flight's trip, even if the flight is one afternoon of it.
 */
export function findUncoveredClusters(
  clusters: readonly PhotoCluster[],
  windows: readonly TravelWindow[],
  { padDays }: { padDays: number },
): PhotoCluster[] {
  const padMs = padDays * DAY_MS;
  return clusters.filter(
    (cluster) =>
      !windows.some(
        (window) =>
          cluster.startMs <= window.endMs + padMs &&
          cluster.endMs >= window.startMs - padMs,
      ),
  );
}

/**
 * Great-circle distance in kilometres.
 *
 * Used to decide whether a cluster is far enough from home to be worth
 * mentioning at all.
 */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
