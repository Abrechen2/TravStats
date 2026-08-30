/**
 * The API mount table — the single source of truth for what is served
 * under /api/v1 and in which order.
 *
 * This used to be ~60 `app.use(...)` lines inline in index.ts. It moved
 * here so that the OpenAPI coverage guard (`services/openapi/coverage.ts`)
 * can walk exactly the same table the running app mounts. Enumerating
 * routes by re-parsing index.ts, or by hand-listing routers in a test,
 * both drift the moment someone adds a router — which is precisely the
 * failure this table exists to make impossible.
 *
 * ORDER IS SIGNIFICANT and load-bearing in several places; the comments
 * below record why. Express matches mounts in array order, so moving an
 * entry can silently change which router answers a request.
 */

import type { Router } from 'express';

import authRoutes from './auth';
import twoFactorRoutes from './auth/twoFactor';
import passkeyRoutes from './auth/passkeys';
import flightRoutes from './flights';
import upcomingRoutes from './upcoming';
import photoJourneyRoutes from './photoJourneys';
import flightLookupRoutes from './flightLookup';
import statsRoutes from './stats';
import airportRoutes from './airports';
import airlineLogoRoutes from './airlineLogos';
import achievementRoutes from './achievements';
import settingsRoutes from './settings';
import analyticsRoutes from './analytics';
import uploadsRoutes from './uploads';
import emailParseRoutes from './emailParse';
import boardingpassParseRoutes from './boardingpassParse';
import boardingpassMatchRoutes from './boardingpassMatch';
import pdfParseRoutes from './pdfParse';
import diagnosticExportRoutes from './diagnosticExport';
import diagnosticsRoutes from './diagnostics';
import setupRoutes from './setup';
import adminRoutes from './admin';
import backupRoutes from './backup';
import pendingUpdatesRoutes from './pendingUpdates';
import templateStatusRoutes from './templateStatus';
import parserTemplatesRoutes from './parserTemplates';
import trainingRoutes from './training';
import tripsRoutes from './trips';
import tourRouteRoutes from './trips/tourRoutes';
import tourLegRoutes from './trips/tourLegs';
import tourRoutingRoutes from './trips/tourRouting';
import tourTrackRoutes from './trips/tourTracks';
import tourIndexRoutes from './trips/tourIndex';
import immichTripRoutes from './immich/tripAlbums';
import immichAssetProxyRoutes from './immich/assetProxy';
import immichTripCoverRoutes from './immich/tripCover';
import passwordResetRoutes from './passwordReset';
import suggestionsRoutes from './suggestions';
import portsRoutes from './ports';
import shipsRoutes from './ships';
import airlinesRoutes from './airlines';
import aircraftRoutes from './aircraft';
import cruisesRouter from './cruises';
import cruiseRouteOverrideRoutes from './cruises/routeOverride';
import currenciesRouter from './currencies';
import lodgingRouter from './lodging';
import lodgingPhotoRouter from './lodging/photos';
import placesRouter from './places';
import xlsxImportRouter from './xlsxImport';
import placeVisitPhotoRouter from './places/visitPhotos';
import placeListsRouter from './placeLists';
import curatedListsRouter from './placeLists/curated';
import lodgingChainsRouter from './lodgingChains';
import lodgingMembershipsRouter from './lodgingMemberships';
import lodgingImportRoutes from './lodgingImport';
import importBatchRoutes from './importBatches';
import companionRoutes from './companions';
import openapiRoutes from './openapi';
import importRoutes from './import';
import pairingRoutes from './pairing';
import appSettingsRoutes from './appSettings';
import geoRoutes from './geo';

export interface ApiMount {
  /** Mount path, always absolute and always under /api/v1. */
  base: string;
  router: Router;
  /**
   * Stable identifier used by the OpenAPI coverage guard to classify a
   * mount. Must be unique across the table — several routers share a
   * `base`, so `base` alone cannot address an entry.
   */
  id: string;
}

export const apiMounts: ApiMount[] = [
  // OpenAPI spec + Swagger UI mounted FIRST so /api/v1/docs and
  // /api/v1/openapi.json don't fall through into authenticated routers.
  { id: 'openapi', base: '/api/v1', router: openapiRoutes },
  { id: 'setup', base: '/api/v1/setup', router: setupRoutes },
  { id: 'admin', base: '/api/v1/admin', router: adminRoutes },
  // Mounted BEFORE the generic /api/v1/auth routers so a future catch-all there
  // can never swallow the two-factor endpoints.
  { id: 'auth.twoFactor', base: '/api/v1/auth/2fa', router: twoFactorRoutes },
  { id: 'auth.passkeys', base: '/api/v1/auth/passkeys', router: passkeyRoutes },
  { id: 'auth', base: '/api/v1/auth', router: authRoutes },
  { id: 'auth.passwordReset', base: '/api/v1/auth', router: passwordResetRoutes },
  { id: 'flights', base: '/api/v1/flights', router: flightRoutes },
  // The dashboard tab strip's "next up" line — one route for every domain,
  // so the strip never depends on which tab happens to have loaded.
  { id: 'upcoming', base: '/api/v1/upcoming', router: upcomingRoutes },
  { id: 'photoJourneys', base: '/api/v1/photo-journeys', router: photoJourneyRoutes },
  { id: 'flightLookup', base: '/api/v1/flight-lookup', router: flightLookupRoutes },
  { id: 'stats', base: '/api/v1/stats', router: statsRoutes },
  { id: 'airports', base: '/api/v1/airports', router: airportRoutes },
  { id: 'airlineLogos', base: '/api/v1/airline-logos', router: airlineLogoRoutes },
  { id: 'achievements', base: '/api/v1/achievements', router: achievementRoutes },
  { id: 'settings', base: '/api/v1/settings', router: settingsRoutes },
  { id: 'analytics', base: '/api/v1/analytics', router: analyticsRoutes },
  { id: 'uploads', base: '/api/v1/uploads', router: uploadsRoutes },
  { id: 'emailParse', base: '/api/v1', router: emailParseRoutes },
  { id: 'boardingpassParse', base: '/api/v1', router: boardingpassParseRoutes },
  { id: 'boardingpassMatch', base: '/api/v1/boardingpass', router: boardingpassMatchRoutes },
  { id: 'pdfParse', base: '/api/v1', router: pdfParseRoutes },
  { id: 'diagnosticExport', base: '/api/v1', router: diagnosticExportRoutes },
  { id: 'diagnostics', base: '/api/v1', router: diagnosticsRoutes },
  { id: 'parserTemplates', base: '/api/v1/parser-templates', router: parserTemplatesRoutes },
  { id: 'backup', base: '/api/v1/backup', router: backupRoutes },
  { id: 'pendingUpdates', base: '/api/v1/pending-updates', router: pendingUpdatesRoutes },
  { id: 'templateStatus', base: '/api/v1/template-status', router: templateStatusRoutes },
  { id: 'training', base: '/api/v1/training', router: trainingRoutes },
  { id: 'trips', base: '/api/v1', router: tripsRoutes },
  // Tour route sections — same-prefix satellite router, same pattern as
  // cruises.routeOverride above — split out of trips.ts once that file
  // crossed the 800-line max. Mounted right after `trips` so `/trips/:id`
  // still resolves to the main router first.
  { id: 'tourRoutes', base: '/api/v1', router: tourRouteRoutes },
  // Leg overrides — same-prefix satellite router, split out of tourRoutes
  // once that file crossed the 400-line ideal ceiling on its own. Mounted
  // right after `tourRoutes` for the same reason that one follows `trips`.
  { id: 'tourLegs', base: '/api/v1', router: tourLegRoutes },
  // Provider-routing endpoints (task 6, phase 3) — same-prefix satellite
  // router, split out of `tourLegs.ts` once it grew past the 400-line ideal
  // ceiling. Mounted right after `tourLegs` for the same reason it follows
  // `tourRoutes`.
  { id: 'tourRouting', base: '/api/v1', router: tourRoutingRoutes },
  // Recorded tracks (task 4, phase 3b) — same-prefix satellite router, split
  // out alongside the others above. Mounted right after `tourRouting`, last
  // among the tour satellites: the plan originally said "after tourLegs",
  // written before `tourRouting` existed; this ordering is a controller
  // ruling made when `tourRouting` landed first.
  { id: 'tourTracks', base: '/api/v1', router: tourTrackRoutes },
  // Dashboard-wide tour listing + batch geometry (task 1, phase 4) — NOT
  // trip-scoped like the four satellites above, so it cannot reuse their
  // `/trips/:id/...` prefix pattern for ownership; mounted last among the
  // tour satellites so it never shadows a more specific `/trips/:id/...`
  // route above it.
  { id: 'tourIndex', base: '/api/v1', router: tourIndexRoutes },
  { id: 'immich.tripAlbums', base: '/api/v1', router: immichTripRoutes },
  { id: 'immich.assetProxy', base: '/api/v1', router: immichAssetProxyRoutes },
  { id: 'immich.tripCover', base: '/api/v1', router: immichTripCoverRoutes },
  { id: 'suggestions', base: '/api/v1/suggestions', router: suggestionsRoutes },
  { id: 'ports', base: '/api/v1/ports', router: portsRoutes },
  { id: 'ships', base: '/api/v1/ships', router: shipsRoutes },
  { id: 'airlines', base: '/api/v1/airlines', router: airlinesRoutes },
  { id: 'aircraft', base: '/api/v1/aircraft', router: aircraftRoutes },
  { id: 'cruises', base: '/api/v1/cruises', router: cruisesRouter },
  // Same-prefix satellite router, same pattern as authRoutes + passwordResetRoutes
  // above — split out of cruises.ts once that file crossed the 800-line max.
  { id: 'cruises.routeOverride', base: '/api/v1/cruises', router: cruiseRouteOverrideRoutes },
  { id: 'currencies', base: '/api/v1/currencies', router: currenciesRouter },
  // Photographs of the house — same prefix, own file. Mounted FIRST for the
  // same reason the visit-photo router is: relying on segment counts to keep
  // two routers on one prefix apart is a rule nobody can see.
  { id: 'lodging.photos', base: '/api/v1/lodging', router: lodgingPhotoRouter },
  { id: 'lodging', base: '/api/v1/lodging', router: lodgingRouter },
  // Photo proof for a visit — same prefix, own file, split out before places.ts
  // approaches the 800-line max. Mounted first so nothing depends on segment
  // counts to keep the two routers apart.
  { id: 'places.visitPhotos', base: '/api/v1/places', router: placeVisitPhotoRouter },
  { id: 'places', base: '/api/v1/places', router: placesRouter },
  { id: 'xlsxImport', base: '/api/v1/xlsx-import', router: xlsxImportRouter },
  // Curated checklists mount FIRST on the same path: '/curated' would
  // otherwise be captured by the lists router's '/:id' and answered 404.
  { id: 'placeLists.curated', base: '/api/v1/place-lists/curated', router: curatedListsRouter },
  { id: 'placeLists', base: '/api/v1/place-lists', router: placeListsRouter },
  { id: 'lodgingChains', base: '/api/v1/lodging-chains', router: lodgingChainsRouter },
  { id: 'lodgingMemberships', base: '/api/v1/lodging-memberships', router: lodgingMembershipsRouter },
  { id: 'lodgingImport', base: '/api/v1/lodging-import', router: lodgingImportRoutes },
  { id: 'importBatches', base: '/api/v1/import-batches', router: importBatchRoutes },
  { id: 'companions', base: '/api/v1/companions', router: companionRoutes },
  { id: 'import', base: '/api/v1/import', router: importRoutes },
  { id: 'pairing', base: '/api/v1/pairing', router: pairingRoutes },
  { id: 'appSettings', base: '/api/v1/app-settings', router: appSettingsRoutes },
  { id: 'geo', base: '/api/v1/geo', router: geoRoutes },
];
