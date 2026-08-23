import { prisma } from "../../db";
import logger from "../../utils/logger";
import { reverseGeocode } from "../geo/nominatim";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { createImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import {
  clusterPhotosByTime,
  distanceKm,
  findUncoveredClusters,
  type PhotoCluster,
  type ScanPhoto,
} from "./cluster";
import { journeyFingerprint } from "./fingerprint";
import { travelWindows } from "./windows";

/**
 * The photo-journey scan: what the library knows that the journal does not.
 *
 * Runs entirely on the user's own infrastructure — their Immich, their
 * TravStats, their geocoder. Nothing about where they have been leaves
 * the two machines they already run.
 *
 * The result is always a SUGGESTION. A photograph proves where a camera
 * was, which is usually but not always where its owner was: a shared
 * album, a picture someone else took, an import from a friend's holiday.
 * Nothing here writes a trip.
 */

/** A pause longer than this starts a new journey. */
const GAP_HOURS = 48;
/** Fewer photos than this is a moment, not a journey. */
const MIN_PHOTOS = 6;
/** Slack around recorded travel, for the taxi and the evening before. */
const PAD_DAYS = 3;
/**
 * Closer to home than this is daily life.
 *
 * Without it the scan reports every wedding, every weekend at the coast
 * and every busy Saturday in town, and the real finds drown in them.
 */
const MIN_DISTANCE_FROM_HOME_KM = 250;
/** Reverse lookups per scan. Nominatim is throttled to 1 req/s upstream,
 * so this is also the scan's floor in seconds. */
const MAX_LOOKUPS = 40;
/** Asset ids kept per journey for the preview strip. */
const PREVIEW_ASSETS = 3;

export type ScanOutcome =
  | { kind: "no-immich" }
  | {
      kind: "scanned";
      photosSeen: number;
      /** Immich had more than the page cap allowed us to read. */
      truncated: boolean;
      created: number;
      updated: number;
    };

export interface ScanOptions {
  /** How far back to look. */
  since: Date;
  until: Date;
  /** Where the user lives, for the distance floor. Omitted = no floor. */
  home?: { lat: number; lon: number } | null;
}

/**
 * Run the scan for one user and persist what it found.
 *
 * Existing journeys are matched by fingerprint and refreshed rather than
 * duplicated, and a journey the user already answered stays answered:
 * re-scanning must never re-ask a dismissed question.
 */
export async function scanPhotoJourneys(
  userId: string,
  { since, until, home }: ScanOptions,
): Promise<ScanOutcome> {
  const connection = await getImmichConnection(userId);
  if (connection === null) {
    return { kind: "no-immich" };
  }

  const client = createImmichClient(connection);
  const { assets, truncated } = await client.searchAssetsByDate({
    takenAfter: since,
    takenBefore: until,
  });

  const photos: ScanPhoto[] = assets.map((asset) => ({
    id: asset.id,
    takenAtMs: Date.parse(asset.fileCreatedAt),
    lat: asset.lat,
    lon: asset.lon,
  }));

  const clusters = clusterPhotosByTime(photos, {
    gapHours: GAP_HOURS,
    minPhotos: MIN_PHOTOS,
  });

  const [flights, trips, cruises, stays] = await Promise.all([
    prisma.flight.findMany({
      where: { userId },
      select: { departureTime: true, arrivalTime: true, status: true },
    }),
    prisma.trip.findMany({
      where: { userId },
      select: { startDate: true, endDate: true },
    }),
    prisma.cruise.findMany({
      where: { userId },
      select: { startDate: true, endDate: true },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: { checkIn: true, checkOut: true },
    }),
  ]);

  const uncovered = findUncoveredClusters(
    clusters,
    travelWindows({ flights, trips, cruises, stays }),
    { padDays: PAD_DAYS },
  );

  const candidates = uncovered
    // Without a position there is nothing to geocode and nothing to
    // check against home, so the row could only ever say "some days in
    // May with 30 photos" — true, and not worth interrupting anyone for.
    .filter((cluster) => cluster.position !== null)
    .filter((cluster) => isAwayFromHome(cluster, home))
    // Biggest first: if the lookup budget runs out, it should run out on
    // the journeys that matter least.
    .sort((a, b) => b.photoCount - a.photoCount)
    .slice(0, MAX_LOOKUPS);

  let created = 0;
  let updated = 0;

  for (const cluster of candidates) {
    const fingerprint = journeyFingerprint(cluster);
    const existing = await prisma.photoJourney.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true, status: true },
    });

    // Already answered. Re-asking a dismissed question every night is
    // how a helpful feature becomes one people turn off.
    if (existing !== null && existing.status !== "pending") {
      continue;
    }

    const place = await lookupPlace(cluster.position!);

    const data = {
      startDate: new Date(cluster.startMs),
      endDate: new Date(cluster.endMs),
      photoCount: cluster.photoCount,
      locatedCount: cluster.locatedCount,
      lat: cluster.position!.lat,
      lon: cluster.position!.lon,
      countryCode: place?.countryCode ?? null,
      countryName: place?.countryName ?? null,
      city: place?.city ?? null,
      previewAssetIds: cluster.photoIds.slice(0, PREVIEW_ASSETS),
    };

    if (existing === null) {
      await prisma.photoJourney.create({
        data: { userId, fingerprint, ...data },
      });
      created += 1;
    } else {
      await prisma.photoJourney.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    }
  }

  logger.info({
    message: "photo_journey_scan_complete",
    context: {
      userId,
      photosSeen: photos.length,
      clusters: clusters.length,
      uncovered: uncovered.length,
      candidates: candidates.length,
      created,
      updated,
      truncated,
    },
  });

  return {
    kind: "scanned",
    photosSeen: photos.length,
    truncated,
    created,
    updated,
  };
}

function isAwayFromHome(
  cluster: PhotoCluster,
  home: { lat: number; lon: number } | null | undefined,
): boolean {
  if (home == null || cluster.position === null) {
    return true;
  }
  return distanceKm(cluster.position, home) >= MIN_DISTANCE_FROM_HOME_KM;
}

/**
 * Ask the geocoder where this is.
 *
 * A failed lookup is not a failed journey: the dates and the photo count
 * are the find, and the place name is decoration on top of them. So this
 * answers null and the row is written without it, rather than dropping a
 * real discovery because a geocoder was down.
 */
async function lookupPlace(position: { lat: number; lon: number }): Promise<{
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
} | null> {
  try {
    const parts = await reverseGeocode(position.lat, position.lon);
    if (parts === null) {
      return null;
    }
    return {
      countryCode: resolveCountryCode(parts.country),
      countryName: parts.country ?? null,
      city: parts.city ?? null,
    };
  } catch (error) {
    logger.warn({
      message: "photo_journey_reverse_geocode_failed",
      context: { lat: position.lat, lon: position.lon, error },
    });
    return null;
  }
}
