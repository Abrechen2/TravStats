import type { DomainKey } from "../../shared/domains";

/**
 * Which entry types can show automatically linked photos, and — for the ones
 * that cannot yet — why not and what the matcher would be given. One registry,
 * like `DOMAIN_SHARING`: a domain added to `shared/domains.ts` must be
 * classified here or `linkTargets.test.ts` fails, so a new entry type cannot
 * silently go without photos.
 *
 * `wired` entries run through `matcher.ts` from their own module; the others
 * carry `reason` (the missing photo surface) and `fit` (the {@link
 * MatchSpec} a follow-up would build), measured 2026-11-21.
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
    wired: false,
    reason: "no photo surface yet: a flight has no photo table or gallery",
    fit: "departure airport from check-in until take-off, arrival airport from landing; two point locations, two windows",
  },
  lodging: {
    wired: false,
    reason:
      "no photo surface yet: LodgingPhoto holds uploaded copies (filename is required) hung off the lodging, not links",
    fit: "check-in to check-out, a point at the lodging with a hotel-sized radius",
  },
  rail: {
    wired: false,
    reason: "no photo surface yet: a rail journey has no photo table or gallery",
    fit: "departure to arrival instants, a corridor along the station-to-station line",
  },
  bus: {
    wired: false,
    reason: "no photo surface yet: a bus journey has no photo table or gallery",
    fit: "departure to arrival instants, a corridor between the terminals",
  },
  ferry: {
    wired: false,
    reason: "no photo surface yet: a ferry journey has no photo table or gallery",
    fit: "departure to arrival instants, a corridor between the ports",
  },
  rental: {
    wired: false,
    reason: "no photo surface yet: a rental booking has no photo table or gallery",
    fit: "pick-up to drop-off, a corridor between the stations (or none: time only is not enough)",
  },
  cruise: {
    wired: false,
    reason: "no photo surface yet: a cruise and its stops have no photo table or gallery",
    fit: "per stop: the stop's local day, a point at the port",
  },
  roadtrip: {
    wired: false,
    reason:
      "TripPhoto.stopId already shows photos on a stop, but the link is made by the user or an album import, not by the matcher",
    fit: "per stop: the stop's day, a point at the station",
  },
  tour: {
    wired: false,
    reason:
      "a package tour is a parser target, not an entry: its trip, stays and cruise carry the photos",
    fit: "none of its own",
  },
};
