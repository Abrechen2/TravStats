import type { SettingsSectionId } from "./settingsModel";

/**
 * The i18n key each section is listed under.
 *
 * A section's heading and its index entry are the same words on purpose: an
 * index that renames what it points at is an index you have to read twice.
 */
export const SECTION_LABEL_KEY: Record<SettingsSectionId, string> = {
  profile: "settings:profile.title",
  security: "settings:security.title",
  apitokens: "settings:apiTokens.title",
  devices: "settings:devices.title",
  display: "settings:display.title",
  units: "settings:units.title",
  domainColors: "settings:domainColors.title",
  modules: "common:settings.modules.title",
  countryCounting: "settings:countryCounting.title",
  backup: "settings:backup.title",
  import: "settings:import.title",
  notifications: "settings:notifications.title",
  about: "settings:about.title",
  externalServices: "settings:externalServices.title",
  homeAirport: "settings:homeAirport.title",
  defaults: "settings:defaults.title",
  features: "settings:features.title",
  enrichment: "settings:historicalEnrichment.title",
  autoupdate: "settings:autoUpdate.title",
  cruisePreferences: "settings:cruisePreferences.title",
  lodgingPreferences: "settings:lodgingPreferences.geocoder.title",
  lodgingMemberships: "settings:memberships.title",
};
