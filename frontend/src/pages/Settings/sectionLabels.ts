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
  locationProvider: "settings:locationProvider.title",
  travTrack: "settings:travTrack.title",
  tripRecording: "settings:tripRecording.title",
  stayScan: "trips:dawarichStays.title",
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
};
