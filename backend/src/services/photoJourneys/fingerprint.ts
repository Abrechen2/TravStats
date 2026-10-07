import type { PhotoCluster } from "./cluster";

/**
 * A stable name for a journey, so re-scanning updates rather than piles up.
 *
 * The scan is meant to run repeatedly — nightly, or whenever the library
 * grows. Without a stable key every run would insert a fresh copy of the
 * same forgotten trip, and a user who dismissed one on Monday would be
 * asked about it again on Tuesday, forever.
 *
 * Built from the calendar day the cluster starts and its position rounded
 * to roughly a tenth of a degree — about 11 km. Both parts have to be
 * coarse: adding photos to a journey nudges the median position and can
 * extend the last day, and a key that changed when that happened would
 * be no key at all. A day and 11 km is stable under "I imported the rest
 * of the holiday" while still separating two different trips.
 */
export function journeyFingerprint(cluster: PhotoCluster): string {
  const day = new Date(cluster.startMs).toISOString().slice(0, 10);
  if (cluster.position === null) {
    // A cluster with no coordinates is identified by its day alone. Two
    // undated-position clusters starting the same day would collide —
    // but they would also be indistinguishable to a human reading them.
    return `${day}|nowhere`;
  }
  const lat = cluster.position.lat.toFixed(1);
  const lon = cluster.position.lon.toFixed(1);
  return `${day}|${lat},${lon}`;
}

/**
 * The key of a `visit` finding (forgejo#211): the journey key, one decimal
 * finer and prefixed.
 *
 * The journey key is a day and an 11 km cell, and inside a city a day holds
 * several stops in one cell — Gyeongbokgung and Bukchon are a kilometre apart
 * and were photographed the same afternoon. Under the journey key the second
 * would overwrite the first every night. A hundredth of a degree (~1 km) and
 * the hour the stop began tell them apart, and are still coarse enough that
 * importing the rest of the afternoon's photos moves neither.
 */
export function visitFingerprint(cluster: PhotoCluster): string {
  const start = new Date(cluster.startMs).toISOString();
  const key =
    cluster.position === null
      ? "nowhere"
      : `${cluster.position.lat.toFixed(2)},${cluster.position.lon.toFixed(2)}`;
  return `visit|${start.slice(0, 13)}|${key}`;
}
