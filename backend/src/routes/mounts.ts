import comparisonRoutes from "./comparison";
import comparisonPeerRoutes from "./comparisonPeer";
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

import type { Router } from "express";

import authRoutes from "./auth";
import twoFactorRoutes from "./auth/twoFactor";
import passkeyRoutes from "./auth/passkeys";
import flightRoutes from "./flights";
import flightEntrySuggestionRoutes from "./flights/entrySuggestions";
import flightTrackRoutes from "./flights/track";
import flightObservedTimesRoutes from "./flights/observedTimes";
import flightBookingRoutes from "./flights/booking";
import flightBulkEditRoutes from "./flights/bulkEdit";
import upcomingRoutes from "./upcoming";
import dawarichStayRoutes from "./dawarichStays";
import photoJourneyRoutes from "./photoJourneys";
import tripSuggestionRoutes from "./tripSuggestions";
import flightLookupRoutes from "./flightLookup";
import statsRoutes from "./stats";
import statsFlightInsightsRoutes from "./stats/flightInsights";
import statsCruiseInsightsRoutes from "./stats/cruiseInsights";
import statsNetworkRouteRoutes from "./stats/networkRoute";
import statsInsightRoutes from "./stats/insights";
import statsDomainRecordsRoutes from "./stats/domainRecords";
import airportRoutes from "./airports";
import airlineLogoRoutes from "./airlineLogos";
import countryFlagRoutes from "./countryFlags";
import loginBackgroundRoutes from "./loginBackgrounds";
import achievementRoutes from "./achievements";
import evidenceRoutes from "./evidence";
import settingsRoutes from "./settings";
import analyticsRoutes from "./analytics";
import uploadsRoutes from "./uploads";
import emailParseRoutes from "./emailParse";
import boardingpassParseRoutes from "./boardingpassParse";
import boardingpassMatchRoutes from "./boardingpassMatch";
import pdfParseRoutes from "./pdfParse";
import imageParseRoutes from "./imageParse";
import diagnosticExportRoutes from "./diagnosticExport";
import setupRoutes from "./setup";
import versionRoutes from "./version";
import adminRoutes from "./admin";
import backupRoutes from "./backup";
import pendingUpdatesRoutes from "./pendingUpdates";
import dataQualityFlagRoutes from "./dataQualityFlags";
import templateStatusRoutes from "./templateStatus";
import parserTemplatesRoutes from "./parserTemplates";
import trainingRoutes from "./training";
import tripsRoutes from "./trips";
import travplanRoutes from "./travplan";
import tripBookingRoutes from "./trips/tripBookings";
import tripPackageRoutes from "./trips/tripPackage";
import tripExchangeRoutes from "./trips/tripExchange";
import tripEntrySuggestionRoutes from "./trips/entrySuggestions";
import tripStopRoutes from "./trips/tripStops";
import tripPhotoRoutes from "./trips/tripPhotos";
import tourRouteRoutes from "./trips/tourRoutes";
import tourLegRoutes from "./trips/tourLegs";
import tourRoutingRoutes from "./trips/tourRouting";
import tourTrackRoutes from "./trips/tourTracks";
import tourTrackArchiveRoutes from "./trips/tourTrackArchive";
import tourIndexRoutes from "./trips/tourIndex";
import tourPointRoutes from "./trips/tourPoints";
import tourKindRoutes from "./trips/tourKind";
import roadtripRoutes from "./roadtrips";
import tripExpenseRoutes from "./trips/tripExpenses";
import stravaRoutes from "./integrations/strava";
import openDataRoutes from "./openData";
import immichTripRoutes from "./immich/tripAlbums";
import immichAssetProxyRoutes from "./immich/assetProxy";
import immichTripCoverRoutes from "./immich/tripCover";
import passwordResetRoutes from "./passwordReset";
import suggestionsRoutes from "./suggestions";
import portsRoutes from "./ports";
import shipsRoutes from "./ships";
import airlinesRoutes from "./airlines";
import aircraftRoutes from "./aircraft";
import cruisesRouter from "./cruises";
import cruiseRouteOverrideRoutes from "./cruises/routeOverride";
import railOperatorRouter from "./rail/operators";
import railRouter from "./rail";
import railStationsRouter from "./rail/stations";
import railEntrySuggestionsRouter from "./rail/entrySuggestions";
import railLookupRouter from "./rail/lookup";
import railShareLinkRouter from "./rail/shareLink";
import railStatsRouter from "./rail/stats";
import railConnectionsRouter from "./rail/connections";
import railRoadtripConversionRouter from "./rail/roadtripConversion";
import busRouter from "./bus";
import ferryRouter from "./ferry";
import ferryRoadtripRouter from "./ferry/roadtrip";
import busEntrySuggestionsRouter from "./bus/entrySuggestions";
import busStatsRouter from "./bus/stats";
import rentalRouter from "./rental";
import rentalStationsRouter from "./rental/stations";
import rentalImportRouter from "./rental/import";
import rentalStatsRouter from "./rental/stats";
import rentalRemindersRouter from "./rental/reminders";
import rentalLinksRouter from "./rental/links";
import rentalProvidersRouter from "./rental/providers";
import cruiseTrackRoutes from "./cruises/tracks";
import currenciesRouter from "./currencies";
import lodgingRouter from "./lodging";
import lodgingPhotoRouter from "./lodging/photos";
import placesRouter from "./places";
import xlsxImportRouter from "./xlsxImport";
import placeVisitPhotoRouter from "./places/visitPhotos";
import placeVisitDateSuggestionRouter from "./places/visitDateSuggestions";
import placeVisitPhotoSuggestionRouter from "./places/visitPhotoSuggestions";
import placeCoverRouter from "./places/placeCover";
import placeRelationsRouter from "./places/relations";
import placeMergeRouter from "./places/merge";
import documentExtractValueRoutes from "./documents/extractValues";
import placeListsRouter from "./placeLists";
import curatedListsRouter from "./placeLists/curated";
import lodgingChainsRouter from "./lodgingChains";
import lodgingMembershipsRouter from "./lodgingMemberships";
import loyaltyMembershipsRouter from "./loyaltyMemberships";
import lodgingImportRoutes from "./lodgingImport";
import placeImportRoutes from "./placeImport";
import importBatchRoutes from "./importBatches";
import companionRoutes from "./companions";
import noteRoutes from "./notes";
import sharingRoutes from "./sharing";
import shareLinkRoutes from "./shareLinks";
import publicShareLinkRoutes from "./publicShareLinks";
import tagRoutes from "./tags";
import openapiRoutes from "./openapi";
import importRoutes from "./import";
import pairingRoutes from "./pairing";
import devicePushRoutes from "./devicePush";
import appSettingsRoutes from "./appSettings";
import jobRoutes from "./jobs";
import geoRoutes from "./geo";
import documentRoutes from "./documents";
import tripPhotoWindowRoutes from "./tripPhotoWindows";
import syncRoutes from "./sync";
import syncPreconditionRoutes from "./syncPreconditions";

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
  { id: "travplan", base: "/api/v1", router: travplanRoutes },
