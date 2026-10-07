import { prisma } from "../../db";
import logger from "../../utils/logger";
import { nightsBetween } from "../../shared/photoScan";
import type { PlaceNameGeocoder } from "../places/placeNameBackfill";
import { throttledPhotonGeocoder } from "../places/photonNameGeocoder";
import { clusterPhotosByStop, type ScanPhoto } from "./cluster";
import { visitFingerprint } from "./fingerprint";
import { nameVisitStop, type VisitName } from "./visitNaming";
import {
  findVisitStops,
  VISIT_STOP_OPTIONS,
  type VisitStop,
  type VisitStopFlight,
  type VisitStopLodging,
  type VisitStopPlace,
  type VisitStopTrip,
} from "./visitStops";

/**
 * The `visit` half of the photo-journey scan (forgejo#211): stops inside a
 * recorded trip that no visit, stay or flight explains, written as pending
 * findings. Split from `scan.ts`, which reads the days NOTHING explains and
 * had a file's worth of reasons of its own.
 *
 * Naming goes through Photon, two requests per stop, throttled to one every
 * 1.1 s — so the cap below is also a floor in seconds, the way the journey
 * scan's Nominatim cap is. The budget is spent biggest stop first, and never
 * on a stop whose row already carries a name or that an own place names.
 */

/** Stops named per scan. Two Photon requests each, so ~45 s at most. */
const MAX_VISIT_LOOKUPS = 20;
/** Asset ids kept per finding for the preview strip — as `scan.ts`. */
const PREVIEW_ASSETS = 3;

export interface VisitScanRows {
  trips: readonly VisitStopTrip[];
  places: readonly VisitStopPlace[];
  lodgings: readonly VisitStopLodging[];
  flights: readonly VisitStopFlight[];
}

export interface VisitScanOutcome {
  stops: number;
  lookups: number;
  created: number;
  updated: number;
}

/** What the row will say the stop is called, and where the words came from. */
type Naming =
  | { source: "place"; name: string; localName: string | null }
  | { source: "stored" }
  | { source: "lookup"; found: VisitName | null };

export async function scanVisitFindings(
  userId: string,
  photos: readonly ScanPhoto[],
  rows: VisitScanRows,
  geocoder: PlaceNameGeocoder = throttledPhotonGeocoder()
): Promise<VisitScanOutcome> {
  const stops = findVisitStops(clusterPhotosByStop(photos, VISIT_STOP_OPTIONS), rows);

  let created = 0;
  let updated = 0;
  let lookups = 0;

  for (const stop of stops) {
    const { cluster } = stop;
    const fingerprint = visitFingerprint(cluster);
    const existing = await prisma.photoJourney.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true, status: true, suggestedName: true },
    });
    // Answered already — the same rule as the journey scan: never re-ask.
    if (existing !== null && existing.status !== "pending") continue;

    let naming: Naming;
    if (stop.place) {
      naming = { source: "place", name: stop.place.name, localName: stop.place.localName };
    } else if (existing?.suggestedName) {
      naming = { source: "stored" };
    } else {
      // Biggest first, so a spent budget runs out on the stops that matter least.
      if (lookups >= MAX_VISIT_LOOKUPS) continue;
      lookups += 1;
      naming = { source: "lookup", found: await lookupName(geocoder, cluster.position!) };
    }

    const data = {
      kind: "visit",
      tripId: stop.tripId,
      placeId: stop.place?.id ?? null,
      ...namedColumns(naming),
      distanceKm: null,
      nights: nightsBetween(cluster.startMs, cluster.endMs),
      airportIata: null,
      spreadKm: null,
      startDate: new Date(cluster.startMs),
      endDate: new Date(cluster.endMs),
      photoCount: cluster.photoCount,
      locatedCount: cluster.locatedCount,
      lat: cluster.position!.lat,
      lon: cluster.position!.lon,
      previewAssetIds: cluster.photoIds.slice(0, PREVIEW_ASSETS),
    };

    if (existing === null) {
      await prisma.photoJourney.create({ data: { userId, fingerprint, ...data } });
      created += 1;
    } else {
      await prisma.photoJourney.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }

  return { stops: stops.length, lookups, created, updated };
}

/**
 * The name columns for one of the three namings. A stored name is left as it
 * is (an empty object changes nothing in the update); the other two write
 * every column, so a lookup that found nothing clears a stale one.
 */
function namedColumns(naming: Naming): Record<string, string | null> {
  if (naming.source === "stored") return {};
  if (naming.source === "place") {
    return {
      suggestedName: naming.name,
      suggestedLocalName: naming.localName,
      suggestedRef: null,
      suggestedCategory: null,
      countryCode: null,
      countryName: null,
      city: null,
    };
  }
  const found = naming.found;
  return {
    suggestedName: found?.name ?? null,
    suggestedLocalName: found?.localName ?? null,
    suggestedRef: found?.ref ?? null,
    suggestedCategory: found?.category ?? null,
    countryCode: found?.countryCode ?? null,
    countryName: found?.country ?? null,
    city: found?.city ?? null,
  };
}

/** A failed lookup is a nameless finding, not a dropped one. */
async function lookupName(
  geocoder: PlaceNameGeocoder,
  at: { lat: number; lon: number }
): Promise<VisitName | null> {
  try {
    return await nameVisitStop(geocoder, at);
  } catch (error) {
    logger.warn({ message: "photo_visit_name_lookup_failed", context: { error } });
    return null;
  }
}

export type { VisitStop };
