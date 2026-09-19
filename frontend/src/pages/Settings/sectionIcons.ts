import type { IconName } from "../../components/ui/Icon";
import type { SettingsSectionId } from "./settingsModel";

/**
 * The icon beside each entry in the settings index — the round-4 export's
 * choices where it drew the section, the nearest Lucide shape where it did not.
 */
export const SECTION_ICON: Record<SettingsSectionId, IconName> = {
  profile: "user",
  security: "shield",
  devices: "smartphone",
  apitokens: "key-round",
  display: "languages",
  units: "sliders-horizontal",
  domainColors: "layers",
  modules: "sparkles",
  countryCounting: "book-open",
  backup: "database",
  import: "upload",
  notifications: "bell",
  about: "info",
  externalServices: "globe",
  homeAirport: "plane",
  defaults: "settings",
  features: "sparkles",
  enrichment: "clock",
  autoupdate: "activity",
  cruisePreferences: "ship",
  lodgingPreferences: "map-pin",
  lodgingMemberships: "bed",
};
