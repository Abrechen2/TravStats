/**
 * Path registration entry point.
 *
 * Importing this module has the side effect of registering every
 * documented endpoint on the shared registry. It is split per domain
 * because a single file cannot hold the full surface inside the 800-line
 * limit — the previous single `paths.ts` was already at 681 lines while
 * covering 18 of 326 endpoints.
 *
 * Adding a domain means adding a module here. Forgetting to is caught by
 * `openapi.coverage.test.ts`, not by review.
 */

import "./shared";

import "./flights";
import "./trips";
import "./tours";
import "./sectionDelete";
import "./tourTracks";
import "./tourIndex";
import "./roadtrips";
import "./tripExpenses";
import "./strava";
import "./openData";
import "./companions";
import "./airports";
import "./stats";
import "./statsPage";
import "./statsNetworkRoute";
import "./parsing";
import "./training";
import "./tokens";
import "./cruises";
import "./rail";
import "./railLookup";
import "./railStats";
import "./busStats";
import "./statsDomainRecords";
import "./railEntrySuggestions";
import "./railRoadtripConversion";
import "./bus";
import "./busEntrySuggestions";
import "./rental";
import "./cruiseTracks";
import "./flightDevice";
import "./flightBooking";
import "./flightBulkEdit";
import "./lodging";
import "./loyalty";
import "./settings";
import "./places";
import "./placePhotos";
import "./placeRelations";
import "./operations";
import "./dataQuality";
import "./accounts";
import "./integrations";
import "./photoJourneys";
import "./tripSuggestions";
import "./catalog";
import "./misc";
import "./countryFlags";
import "./loginBackgrounds";
import "./xlsxImport";
import "./settingsRouting";
import "./documents";
import "./jobs";
import "./timeMigration";
import "./sync";
