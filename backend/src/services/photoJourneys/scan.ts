import { prisma } from "../../db";
import logger from "../../utils/logger";
import { reverseGeocode } from "../geo/nominatim";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import {
  PHOTO_SCAN_GAP_HOURS,
  PHOTO_SCAN_MIN_PHOTOS,
  PHOTO_SCAN_PAD_DAYS,
  homeCoordinate,
  mostVisitedIata,
  nightsBetween,
  rankReadings,
  whereItWas,
  type DatedStay,
  type FlightEndpoints,
  type LocatedCluster,
  type PlaceWithVisits,
} from "../../shared/photoScan";
import { createImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import {
  clusterPhotosByTime,
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
 * Nothing here writes a trip, a visit or a stay.
 *
 * The expensive half — reading the library, clustering, dropping what
 * recorded travel explains — happens here. What each surviving burst is
 * taken for (a visit to an own place, a forgotten trip, nights away) is the
 * pure rule in `shared/photoScan.ts`, the one the Companion also reads
 * (forgejo#94).
 */

/** Reverse lookups per scan. Nominatim is throttled to 1 req/s upstream,
 * so this is also the scan's floor in seconds. Only a trip finding needs
 * one: a place or stay finding is named by the account's own place. */
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
}

/** One burst, and what the strongest fitting reading took it for. */
export interface Finding {
  cluster: PhotoCluster;
  located: LocatedCluster;
  kind: "place" | "trip" | "stay";
  placeId: string | null;
  distanceKm: number | null;
  airportIata: string | null;
  spreadKm: number | null;
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
  { since, until }: ScanOptions
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
    gapHours: PHOTO_SCAN_GAP_HOURS,
    minPhotos: PHOTO_SCAN_MIN_PHOTOS,
  });

  const [flights, trips, cruises, stays, places] = await Promise.all([
    prisma.flight.findMany({
      where: { userId },
      select: {
        departureTime: true,
        arrivalTime: true,
        status: true,
        depIata: true,
        depLat: true,
        depLon: true,
        arrIata: true,
        arrLat: true,
        arrLon: true,
      },
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
    prisma.place.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        visits: { select: { visitedAt: true } },
      },
    }),
  ]);

  const uncovered = findUncoveredClusters(
    clusters,
    travelWindows({ flights, trips, cruises, stays }),
    {
      padDays: PHOTO_SCAN_PAD_DAYS,
    }
  );

  const findings = readFindings(uncovered, flights, places, stays);

  let created = 0;
  let updated = 0;
  let lookups = 0;

  for (const finding of findings) {
    const { cluster, located } = finding;
    // The fingerprint stays on the MEDIAN position it has always used, not on
    // the displayed coordinate: a key that moved with the rule would re-ask
    // every question the user has already dismissed.
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

    let place: Awaited<ReturnType<typeof lookupPlace>> = null;
    if (finding.kind === "trip") {
      // Findings arrive biggest first: if the lookup budget runs out, it runs
      // out on the journeys that matter least.
      if (lookups >= MAX_LOOKUPS) continue;
      lookups += 1;
      place = await lookupPlace(located);
    }

    const data = {
      kind: finding.kind,
      placeId: finding.placeId,
      distanceKm: finding.distanceKm,
      nights: located.nights,
      airportIata: finding.airportIata,
      spreadKm: finding.spreadKm,
      startDate: new Date(cluster.startMs),
      endDate: new Date(cluster.endMs),
      photoCount: cluster.photoCount,
      locatedCount: cluster.locatedCount,
      lat: located.lat,
      lon: located.lon,
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
      findings: findings.length,
      lookups,
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

/**
 * The bursts nothing recorded explains, each taken for the strongest reading
 * that fits, biggest first.
 *
 * A burst with no coordinate at all falls away here: without a position there
 * is no place, no airport and nothing to name, so the row could only ever say
 * "some days in May with 30 photos" — true, and not worth interrupting anyone
 * for. Exported for its test.
 */
export function readFindings(
  uncovered: readonly PhotoCluster[],
  flights: readonly FlightEndpoints[],
  places: readonly PlaceWithVisits[],
  stays: readonly DatedStay[]
): Finding[] {
  const home = homeCoordinate(flights, mostVisitedIata(flights));
  const clusterOf = new Map<LocatedCluster, PhotoCluster>();
  for (const cluster of uncovered) {
    const at = whereItWas(cluster.samples, home);
    if (at === null) continue;
    clusterOf.set(
      {
        startMs: cluster.startMs,
        endMs: cluster.endMs,
        nights: nightsBetween(cluster.startMs, cluster.endMs),
        photoIds: cluster.photoIds,
        lat: at.lat,
        lon: at.lon,
        samples: cluster.samples,
      },
      cluster
    );
  }

  const readings = rankReadings([...clusterOf.keys()], flights, places, stays);
  const finding = (
    located: LocatedCluster,
    rest: Omit<Finding, "cluster" | "located">
  ): Finding => ({ cluster: clusterOf.get(located)!, located, ...rest });

  return [
    ...readings.place.map((h) =>
      finding(h.cluster, {
        kind: "place",
        placeId: h.placeId,
        distanceKm: h.distanceKm,
        airportIata: null,
        spreadKm: null,
      })
    ),
    ...readings.trip.map((h) =>
      finding(h.cluster, {
        kind: "trip",
        placeId: null,
        distanceKm: h.distanceKm,
        airportIata: h.iata,
        spreadKm: h.spreadKm,
      })
    ),
    ...readings.stay.map((h) =>
      finding(h.cluster, {
        kind: "stay",
        placeId: h.placeId,
        distanceKm: null,
        airportIata: null,
        spreadKm: null,
      })
    ),
  ].sort((a, b) => b.cluster.photoCount - a.cluster.photoCount);
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
