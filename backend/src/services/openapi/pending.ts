/**
 * Endpoints that exist but are not in the OpenAPI spec yet.
 *
 * This list is a RATCHET, not a permanent exception list. The coverage
 * guard fails in both directions:
 *
 *   - an endpoint that is neither documented nor listed here  → new drift
 *   - an entry here that IS documented                        → stale entry
 *
 * So a new route cannot ship undocumented and unnoticed, and documenting
 * one forces its line to be deleted. The list only shrinks. When it is
 * empty, delete the file and the guard becomes a plain completeness
 * assertion.
 *
 * Seeded 2026-08-28 with the 244 endpoints that had accumulated while the
 * spec described itself as a curated subset. Owner decision that day: the
 * spec is to be complete for everything a normal user token can reach.
 * Admin and setup are out of scope and live in UNDOCUMENTED_MOUNTS
 * instead — they are not pending, they are excluded.
 */

export const PENDING_DOCUMENTATION: readonly string[] = [
  // achievements (4)
  "GET /achievements",
  "GET /achievements/leaderboard",
  "GET /achievements/recent",
  "POST /achievements/check",
  // aircraft (2)
  "GET /aircraft",
  "POST /aircraft",
  // airlineLogos (1)
  "GET /airline-logos/{code}",
  // airlines (2)
  "GET /airlines",
  "POST /airlines",
  // airports (4)
  "GET /airports/coords/nearest",
  "GET /airports/{code}",
  "POST /airports",
  "POST /airports/enrich",
  // analytics (1)
  "POST /analytics/events",
  // appSettings (2)
  "GET /app-settings",
  "PUT /app-settings",
  // auth (5)
  "GET /auth/me",
  "POST /auth/change-password",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/register",
  // auth.passkeys (8)
  "DELETE /auth/passkeys/{id}",
  "GET /auth/passkeys",
  "GET /auth/passkeys/availability",
  "PATCH /auth/passkeys/{id}",
  "POST /auth/passkeys/login/options",
  "POST /auth/passkeys/login/verify",
  "POST /auth/passkeys/register/options",
  "POST /auth/passkeys/register/verify",
  // auth.passwordReset (5)
  "GET /auth/registration-status",
  "GET /auth/smtp-status",
  "POST /auth/force-change-password",
  "POST /auth/forgot-password",
  "POST /auth/reset-password",
  // auth.twoFactor (6)
  "GET /auth/2fa/status",
  "POST /auth/2fa/activate",
  "POST /auth/2fa/disable",
  "POST /auth/2fa/recovery-codes",
  "POST /auth/2fa/setup",
  "POST /auth/2fa/verify",
  // backup (12)
  "DELETE /backup/{id}",
  "GET /backup",
  "GET /backup/cloud/list",
  "GET /backup/status",
  "GET /backup/{id}",
  "GET /backup/{id}/download",
  "POST /backup",
  "POST /backup/cleanup",
  "POST /backup/cloud/download",
  "POST /backup/cloud/test",
  "POST /backup/{id}/restore",
  "POST /backup/{id}/sync",
  // boardingpassMatch (1)
  "POST /boardingpass/propose",
  // boardingpassParse (3)
  "GET /parse-boardingpass/availability",
  "GET /parse-boardingpass/check",
  "GET /parse-boardingpass/providers",
  // cruises (7)
  "DELETE /cruises/{id}",
  "GET /cruises",
  "GET /cruises/{id}",
  "GET /cruises/{id}/geometry",
  "PATCH /cruises/{id}",
  "POST /cruises",
  "POST /cruises/geometry/batch",
  // cruises.routeOverride (2)
  "DELETE /cruises/{id}/route-override",
  "PUT /cruises/{id}/route-override",
  // currencies (1)
  "GET /currencies/recent",
  // diagnosticExport (1)
  "GET /diagnostic-export",
  // emailParse (1)
  "POST /parse-email-file",
  // flightLookup (2)
  "GET /flight-lookup/{flightNumber}",
  "POST /flight-lookup/bulk",
  // flights (7)
  "GET /flights/enrichment-candidates",
  "GET /flights/geo",
  "GET /flights/next",
  "GET /flights/refresh-historical-bulk/preview",
  "GET /flights/{id}/route-estimation",
  "POST /flights/refresh-historical-bulk",
  "POST /flights/{id}/enrich-historical",
  // geo (3)
  "GET /geo/reverse",
  "GET /geo/reverse-places",
  "GET /geo/search",
  // immich.assetProxy (1)
  "GET /trips/{id}/immich/albums/{linkId}/assets/{assetId}/file",
  // immich.tripAlbums (7)
  "DELETE /trips/{id}/immich/albums/{linkId}",
  "GET /trips/{id}/immich/albums",
  "GET /trips/{id}/immich/albums/{linkId}/assets",
  "GET /trips/{id}/immich/albums/{linkId}/import-job",
  "GET /trips/{id}/immich/estimate",
  "POST /trips/{id}/immich/albums",
  "POST /trips/{id}/immich/albums/{linkId}/resync",
  // immich.tripCover (2)
  "POST /trips/{id}/immich/cover",
  "POST /trips/{id}/photos/{photoId}/cover",
  // import (2)
  "POST /import/parse",
  "POST /import/preview",
  // importBatches (4)
  "DELETE /import-batches/{id}",
  "GET /import-batches",
  "GET /import-batches/{id}/items",
  "POST /import-batches",
  // lodging (9)
  "DELETE /lodging/{id}",
  "DELETE /lodging/{id}/stays/{stayId}",
  "GET /lodging",
  "GET /lodging/fx-preview",
  "GET /lodging/{id}",
  "PATCH /lodging/{id}",
  "PATCH /lodging/{id}/stays/{stayId}",
  "POST /lodging",
  "POST /lodging/{id}/stays",
  // lodgingChains (3)
  "GET /lodging-chains",
  "GET /lodging-chains/{id}",
  "POST /lodging-chains",
  // lodgingImport (5)
  "DELETE /lodging-import/batches/{id}",
  "GET /lodging-import/batches",
  "POST /lodging-import/commit",
  "POST /lodging-import/preview",
  "POST /lodging-import/suggest-mapping",
  // lodgingMemberships (4)
  "DELETE /lodging-memberships/{id}",
  "GET /lodging-memberships",
  "PATCH /lodging-memberships/{id}",
  "POST /lodging-memberships",
  // pairing (4)
  "POST /pairing/claim",
  "POST /pairing/start",
  "POST /pairing/status",
  "POST /pairing/unpair",
  // parserTemplates (4)
  "DELETE /parser-templates/{id}",
  "GET /parser-templates",
  "GET /parser-templates/{id}",
  "PATCH /parser-templates/{id}",
  // pdfParse (1)
  "POST /parse-pdf",
  // pendingUpdates (8)
  "DELETE /pending-updates/{id}",
  "GET /pending-updates",
  "GET /pending-updates/statistics",
  "GET /pending-updates/{id}",
  "POST /pending-updates/{id}/apply",
  "POST /pending-updates/{id}/preview",
  "POST /pending-updates/{id}/reject",
  "PUT /pending-updates/{id}",
  // photoJourneys (3)
  "GET /photo-journeys",
  "PATCH /photo-journeys/{id}",
  "POST /photo-journeys/scan",
  // placeLists (8)
  "DELETE /place-lists/{id}",
  "DELETE /place-lists/{id}/entries/{placeId}",
  "GET /place-lists",
  "GET /place-lists/{id}",
  "PATCH /place-lists/{id}",
  "POST /place-lists",
  "POST /place-lists/{id}/entries",
  "PUT /place-lists/{id}/entries/order",
  // placeLists.curated (7)
  "DELETE /place-lists/curated/items/{itemId}/tick",
  "DELETE /place-lists/curated/{key}/subscribe",
  "GET /place-lists/curated",
  "GET /place-lists/curated/{key}/progress",
  "GET /place-lists/curated/{key}/suggestions",
  "POST /place-lists/curated/items/{itemId}/tick",
  "POST /place-lists/curated/{key}/subscribe",
  // places (8)
  "DELETE /places/visits/{visitId}",
  "DELETE /places/{id}",
  "GET /places",
  "GET /places/{id}",
  "PATCH /places/visits/{visitId}",
  "PATCH /places/{id}",
  "POST /places",
  "POST /places/{id}/visits",
  // places.visitPhotos (5)
  "DELETE /places/visits/{visitId}/photos/{photoId}",
  "GET /places/visits/{visitId}/photos",
  "GET /places/visits/{visitId}/photos/{photoId}/file",
  "PATCH /places/visits/{visitId}/photos/{photoId}",
  "POST /places/visits/{visitId}/photos",
  // ports (3)
  "GET /ports",
  "GET /ports/geocode",
  "POST /ports",
  // settings (25)
  "DELETE /settings/home-airports/{index}",
  "DELETE /settings/profile-picture",
  "GET /settings",
  "GET /settings/api-keys",
  "GET /settings/api-keys/quota",
  "GET /settings/home-airports",
  "GET /settings/immich",
  "GET /settings/notifications",
  "GET /settings/parser",
  "GET /settings/profile",
  "GET /settings/profile-picture/{filename}",
  "PATCH /settings/home-airports/{index}",
  "POST /settings/api-keys/test/aerodatabox",
  "POST /settings/api-keys/test/airlabs",
  "POST /settings/api-keys/test/aviationstack",
  "POST /settings/api-keys/test/opensky",
  "POST /settings/home-airports",
  "POST /settings/immich/test",
  "POST /settings/profile-picture",
  "PUT /settings",
  "PUT /settings/api-keys",
  "PUT /settings/immich",
  "PUT /settings/notifications",
  "PUT /settings/parser",
  "PUT /settings/profile",
  // ships (2)
  "GET /ships",
  "POST /ships",
  // stats (16)
  "GET /stats/aircraft",
  "GET /stats/aircraft-types",
  "GET /stats/aircraft/{registration}",
  "GET /stats/airlines",
  "GET /stats/airports",
  "GET /stats/business",
  "GET /stats/countries",
  "GET /stats/cruise",
  "GET /stats/fun",
  "GET /stats/lodging",
  "GET /stats/punctuality",
  "GET /stats/routes",
  "GET /stats/seats",
  "GET /stats/timeseries",
  "GET /stats/travel-account",
  "GET /stats/unique",
  // suggestions (2)
  "GET /suggestions/aircraft",
  "GET /suggestions/airlines",
  // templateStatus (2)
  "GET /template-status",
  "POST /template-status/sync",
  // training (3)
  "GET /training/{id}",
  "POST /training/upload",
  "POST /training/{id}/annotate",
  // trips (22)
  "DELETE /trips/{id}",
  "DELETE /trips/{id}/journal/{entryId}",
  "DELETE /trips/{id}/photos/{photoId}",
  "DELETE /trips/{id}/stops/{stopId}",
  "GET /trips/cleanup/micro",
  "GET /trips/{id}/photos/{photoId}/file",
  "PATCH /trips/bookings/{id}",
  "PATCH /trips/{id}",
  "PATCH /trips/{id}/journal/{entryId}",
  "PATCH /trips/{id}/photos/{photoId}",
  "PATCH /trips/{id}/stops/{stopId}",
  "POST /trips",
  "POST /trips/bookings",
  "POST /trips/cleanup/dissolve",
  "POST /trips/detect",
  "POST /trips/merge",
  "POST /trips/{id}/cover",
  "POST /trips/{id}/flights",
  "POST /trips/{id}/journal",
  "POST /trips/{id}/photos",
  "POST /trips/{id}/stops",
  "POST /trips/{id}/summarize",
  // upcoming (1)
  "GET /upcoming",
  // uploads (3)
  "DELETE /uploads/receipts/{filename}",
  "GET /uploads/receipts/{filename}",
  "POST /uploads/receipt",
];
