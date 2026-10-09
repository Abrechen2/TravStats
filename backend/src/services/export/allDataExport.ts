import { prisma } from "../../db";

/**
 * What `GET /admin/export/all-data` carries per user — kept here so the route
 * stays a route, and so a test can hold it against the schema: every list
 * relation on `User` is either selected below or named in
 * `EXPORT_EXCLUDED_USER_RELATIONS` with the reason it is left out. A new
 * user-owned table therefore cannot drop out of the export in silence, which
 * is how five domains were once missing from a file calling itself a backup.
 *
 * It is NOT the restore path (that is a pg_dump, see `services/backup/`). It is
 * a human-readable dump, so credential material stays out on purpose.
 *
 * Nothing in TravStats reads this file back — no import, no restore, no
 * Companion path (checked 2026-09-26). That matters for one renamed key: since
 * 2.7 the loyalty cards travel as `loyaltyMemberships` (owner, 2026-09-26);
 * exports written before carry the same rows as `lodgingMemberships`. The day a
 * reader is added it must accept both keys, preferring the new one, and prove
 * it with an old-shape fixture.
 */
export const USER_EXPORT_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  isAdmin: true,
  isActive: true,
  invitedBy: true,
  createdAt: true,
  birthdate: true,
  notificationEmail: true,
  notifyBefore24h: true,
  notifyBefore2h: true,
  // Deliberately excluded scalar columns: passwordHash, resetToken/changeToken
  // and their expiries, every twoFactor* column.

  // Travel data — the point of the export. Companion LINKS travel with their
  // record: the companions list alone says who, never on which journey.
  // A flight's phone recording travels with it: no provider can supply it again.
  flights: { include: { companionLinks: true, track: true } },
  cruises: { include: { stops: true, legs: true, tracks: true, companionLinks: true } },
  trips: {
    include: {
      stops: true,
      journalEntries: { include: { photos: true } },
      photos: true,
      companionLinks: true,
      // Which Immich albums a trip links, and in which mode. The album's
      // images live on the user's Immich; the link is what exists only here.
      immichAlbums: true,
    },
  },
  // Tours and roadtrips from the user's side, not the trip's: one with no
  // trip is reachable from nowhere else, stations and recordings with it. A
  // trip-borrowed station appears under both — twice is honest, missing is not.
  tourRoutes: {
    include: {
      stops: { orderBy: { routeOrderIdx: "asc" } },
      legs: true,
      tracks: true,
    },
  },
  // Ferry tickets, tolls, pitch fees, fuel (forgejo#140) from the user's side:
  // a standalone roadtrip's are reachable from no trip. Since 2.7 a leg's toll
  // is one of these (kind `toll`) and no longer a field of the leg above.
  tripExpenses: true,
  bookings: true,
  lodgings: { include: { photos: true, membershipLinks: true } },
  lodgingStays: true,
  // Loyalty cards across domains, with the status history — the key was
  // `lodgingMemberships` before 2.7 (see the module comment).
  loyaltyMemberships: { include: { chains: true } },
  // The user's own hotel chains (per-user since 2.7, `services/lodging/chainScope.ts`).
  // Catalogue chains (no owner) are re-seeded and stay out.
  lodgingChains: true,
  places: true,
  // The other OSM/Google references a place answers to after a merge
  // (forgejo#232): without them a re-import of the export's source would
  // bring the merged duplicate back.
  placeExternalRefs: true,
  placeVisits: { include: { photos: true } },
  placeLists: { include: { entries: true } },
  // Rail (spec 2026-09-25-rail-domain): the rides with their companion links,
  // frozen line included — it cannot be fetched again for a past day.
  railJourneys: { include: { companionLinks: true } },
  // Car rentals (spec 2026-10-01-rental-domain-design): the contracts with
  // their companion links — km and final amount included, which only an
  // invoice could supply again.
  rentalBookings: { include: { companionLinks: true } },
  // Bus rides (spec 2026-10-07-bus-domain-design): the rides with their
  // companion links — the terminals' frozen names and zones included.
  busJourneys: { include: { companionLinks: true } },
  companions: true,
  // Kept originals (forgejo#116): the rows — what each is, where it is filed,
  // what its parse read. The bytes stay out, as a photo's do.
  documents: true,
  // The receipt files' rows (the files are in the pg_dump backup's archive).
  receiptUploads: true,
  // Which import each record came from — the provenance an undo reads.
  importBatches: true,
  // The user's own parser templates: work nobody can rebuild from the rows.
  parserTemplates: true,
  // Measured presence (location history reduced to country-days) and the
  // journeys the photo inbox proposed from it: evidence the passport reads.
  countryDays: true,
  photoJourneys: true,
  // The answers to trip suggestions: without them a restored account would be
  // asked again every question it already dismissed. The suggestions
  // themselves are derived and never stored.
  tripSuggestionAnswers: true,
  // Visit photo suggestions the user refused ("Nicht diese", forgejo#132
  // item 13): the same reason — a restored account must not be offered them again.
  visitPhotoRefusals: true,
  userAchievements: { include: { achievement: true } },
  // Field-by-field: the stored API keys are not part of a data export.
  settings: {
    select: {
      enabledDomains: true,
      baseCurrency: true,
      data: true,
      appPrefs: true,
      autoCreateTrips: true,
      preferredVisionParser: true,
      preferredTextParser: true,
      immichDefaultMode: true,
      autoUpdateEnabled: true,
      autoUpdateRequireApproval: true,
      historicalEnrichmentEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

/** Every `User` list relation the export leaves out, and why. */
export const EXPORT_EXCLUDED_USER_RELATIONS: Record<string, string> = {
  twoFactorRecoveryCodes: "credential material",
  webauthnCredentials: "credential material",
  apiTokens: "credential material",
  pairingCodes: "credential material",
  devicePushes:
    "credential material: a phone's push token and sealing key, bound to an API token that is not exported either",
  createdInvitations: "instance administration, carries invitation tokens",
  usedInvitations: "instance administration, carries invitation tokens",
  analyticsEvents: "anonymous usage telemetry, not the user's travel data",
  trainingData: "parser training corpus of raw source text, operational",
  parseLogs: "parser training log, operational",
  pendingFlightUpdates: "transient queue of suggested flight changes",
  dataQualityFlags: "derived by the data-quality sweep, recomputed from the rows",
};

/**
 * Catalogue rows a user added. They belong to no user but exist nowhere else:
 * every seeded catalogue is re-seeded from its vendored file, these are not —
 * and a cruise stop or a flight may point at one.
 */
export async function loadUserAddedCatalogue(): Promise<{
  userAddedRailStations: unknown[];
  userAddedAirports: unknown[];
  userAddedAirlines: unknown[];
  userAddedAircraft: unknown[];
  userAddedShips: unknown[];
  userAddedPorts: unknown[];
  userAddedLodgingChains: unknown[];
}> {
  const where = { isUserAdded: true };
  const [railStations, airports, airlines, aircraft, ships, ports, lodgingChains] =
    await Promise.all([
      prisma.railStation.findMany({ where, orderBy: { id: "asc" } }),
      prisma.airport.findMany({ where }),
      prisma.airline.findMany({ where }),
      prisma.aircraft.findMany({ where }),
      prisma.ship.findMany({ where }),
      prisma.port.findMany({ where }),
      // An owned chain travels with its user (`lodgingChains` above); only an
      // owner-less user-added row would be lost otherwise.
      prisma.lodgingChain.findMany({ where: { ...where, userId: null } }),
    ]);
  return {
    userAddedRailStations: railStations,
    userAddedAirports: airports,
    userAddedAirlines: airlines,
    userAddedAircraft: aircraft,
    userAddedShips: ships,
    userAddedPorts: ports,
    userAddedLodgingChains: lodgingChains,
  };
}
