import type { SettingsSectionId } from "./settingsModel";

/**
 * The i18n key each section is listed under.
 *
 * A section's heading, its anchor chip and its search title are the same words
 * on purpose: an index that renames what it points at is an index you have to
 * read twice.
 */
export const SECTION_LABEL_KEY: Record<SettingsSectionId, string> = {
  profile: "settings:profile.title",
  home: "settings:home.title",
  deletion: "settings:deleteAccount.title",
  planning: "settings:planning.title",
  security: "settings:security.title",
  devices: "settings:devices.title",
  notifications: "settings:notifications.title",
  apitokens: "settings:apiTokens.title",
  display: "settings:display.title",
  units: "settings:units.title",
  domains: "settings:domains.title",
  countryCounting: "settings:countryCounting.title",
  trips: "settings:trips.title",
  suggestions: "settings:inboxSuggestions.title",
  sharing: "sharing:settings.title",
  companions: "companions:manage.title",
  shareLinks: "sharing:links.section.title",
  calendarFeed: "settings:calendarFeed.title",
  dawarich: "trips:tours.dawarichSettings.title",
  ttRecording: "settings:tt.recording.title",
  ttPlaces: "settings:tt.places.title",
  ttZones: "settings:tt.zones.title",
  ttDetect: "settings:tt.detect.title",
  ttSources: "settings:tt.sources.title",
  ttExport: "settings:tt.export.title",
  ttDelete: "settings:tt.delete.title",
  ttDiag: "settings:tt.diag.title",
  loyalty: "settings:memberships.title",
  homeAirport: "settings:homeAirport.title",
  autoupdate: "settings:autoUpdate.title",
  features: "settings:features.title",
  defaults: "settings:defaults.title",
  enrichment: "settings:historicalEnrichment.title",
  cruisePreferences: "settings:cruisePreferences.title",
  backup: "settings:backup.title",
  import: "settings:import.title",
  externalServices: "settings:externalServices.title",
  mapAppearance: "settings:views.title",
  comparisonConsent: "settings:privacy.comparisonConsent.title",
  encryptedGrants: "settings:privacy.encryptedGrants.title",
};
