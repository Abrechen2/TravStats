import type { DomainKey } from "../../shared/domains";

/**
 * Which entry types can show automatically linked photos, and — for the ones
 * that cannot yet — why not and what the matcher would be given. One registry,
 * like `DOMAIN_SHARING`: a domain added to `shared/domains.ts` must be
 * classified here or `linkTargets.test.ts` fails, so a new entry type cannot
 * silently go without photos.
 *
 * `wired` entries run through `matcher.ts`: the place visit from
 * `services/places/visitPhotoAutoLink.ts`, every other kind from `entryKinds.ts`
 * (its plan) and `entryPhotos.ts` (the pass); `fit` says what the plan matches.
 * An unwired one carries `reason`. Measured 2026-11-21.
 */
export type PhotoLinkTarget =
  { wired: true; entry: string; fit: string } | { wired: false; reason: string; fit: string };

export const PHOTO_LINK_TARGETS: Readonly<Record<DomainKey, PhotoLinkTarget>> = {
  poi: {
    wired: true,
    entry: "placeVisit",
    fit: "the visit's local day, a point at the place with PHOTO_RADIUS_KM",
  },
  flight: {
    wired: true,
    entry: "flight",
    fit: "departure airport from 2 h before take-off until take-off, arrival airport from landing until 2 h after; two point locations, two windows",
  },
  lodging: {
    wired: true,
    entry: "stay",
    fit: "check-in to check-out (instants, else the local days), a point at the lodging with STAY_RADIUS_KM; LodgingPhoto uploads stay beside the links",
  },
  rail: {
    wired: true,
    entry: "rail",
    fit: "departure to arrival instants, a corridor along the station-to-station line",
  },
  bus: {
    wired: true,
    entry: "bus",
    fit: "departure to arrival instants, a corridor between the terminals",
  },
  ferry: {
    wired: true,
    entry: "ferry",
    fit: "departure to arrival instants, a corridor between the ports",
  },
  rental: {
    wired: true,
    entry: "rental",
    fit: "pick-up to drop-off instants, a wide corridor between the stations (time bounds it)",
  },
  cruise: {
    wired: true,
    entry: "cruiseStop",
    fit: "per stop: the stop's local day at the port, a point at the port; a sea day has no position and matches nothing",
  },
  roadtrip: {
    wired: true,
    entry: "roadtripStop",
    fit: "per station: its local days, a point at the station; TripPhoto.stopId photos (picked or album import) show beside the links",
  },
  tour: {
    wired: false,
    reason:
      "a package tour is a parser target, not an entry: its trip, stays and cruise carry the photos",
    fit: "none of its own",
  },
};
