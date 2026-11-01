import { SECTION_LABEL_KEY } from "./sectionLabels";
import { type SectionDef } from "./surface";
import type { SettingsLevel } from "../../store/settingsLevelStore";

/**
 * The personal sections the settings area mounts (see `area/areaModel.ts`, which
 * places them on pages). Each carries its level, beta gate and search flags;
 * the page structure of the old `/settings/<page>` surface is gone — the
 * registry and the area's page table are the only ones now.
 *
 * Standard is what a person needs to set TravStats up and use it; expert is
 * tuning, plumbing and operations — the classification the owner decided on
 * 2026-10-20 (forgejo#321, first comment).
 */
/** Every section that can render. Ids are stable — links carry them. */
export type SettingsSectionId =
  | "profile"
  | "home"
  | "deletion"
  | "planning"
  | "security"
  | "devices"
  | "notifications"
  | "apitokens"
  | "display"
  | "units"
  | "domains"
  | "countryCounting"
  | "trips"
  | "suggestions"
  | "sharing"
  | "companions"
  | "shareLinks"
  | "calendarFeed"
  | "dawarich"
  | "locationProvider"
  | "travTrack"
  | "tripRecording"
  | "stayScan"
  | "loyalty"
  | "homeAirport"
  | "autoupdate"
  | "features"
  | "defaults"
  | "enrichment"
  | "cruisePreferences"
  | "backup"
  | "import"
  | "externalServices"
  | "mapAppearance"
  | "comparisonConsent"
  | "encryptedGrants";

export type SettingsSectionDef = SectionDef<SettingsSectionId>;

const section = (
  id: SettingsSectionId,
  level: SettingsLevel = "standard",
  extra: Partial<SettingsSectionDef> = {}
): SettingsSectionDef => ({ id, labelKey: SECTION_LABEL_KEY[id], level, ...extra });

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  section("profile"),
  section("home"),
  section("security"),
  // Behind its beta key; `?section=devices` still shows it, because a pairing
  // code has no other place to be minted while the key is closed.
  section("devices", "standard", { gate: "devicePairing", gateYieldsToLink: true }),
  section("notifications"),
  section("apitokens", "expert", { settings: 1 }),
  section("deletion"),
  section("display"),
  section("units"),
  section("domains"),
  section("planning"),
  section("countryCounting"),
  // Where the map, the dashboard and the lists are set is on the map, the
  // dashboard and the lists (rule 1 of the settings redesign).
  section("mapAppearance"),
  section("trips"),
  section("suggestions"),
  section("sharing"),
  section("calendarFeed", "standard"),
  section("companions"),
  // TravTrack's history shows while the account holds data or the instance
  // shows TravTrack (plan T6); the stay scan is standard, only its two area
  // switches are expert rows (forgejo#318).
  section("locationProvider"),
  section("travTrack", "standard", { when: "travTrackHeld" }),
  section("dawarich"),
  section("tripRecording"),
  section("stayScan"),
  section("loyalty"),
  section("shareLinks"),
  section("comparisonConsent", "standard", { gate: "comparison" }),
  section("encryptedGrants", "standard", { gate: "encryptedShare" }),
  section("homeAirport"),
  section("autoupdate", "standard", { expertRows: true }),
  section("features"),
  section("defaults"),
  section("enrichment", "expert", { settings: 3 }),
  section("cruisePreferences"),
  section("backup", "standard", { expertRows: true }),
  section("import"),
  section("externalServices", "standard", { expertRows: true, foldsRows: true }),
];

/**
 * Section ids that were renamed or folded into another section. Links carry
 * every one of them: `apiKeys`/`apikeys` predate `externalServices` (#182), the
 * per-domain loyalty sections became one (2026-09-26), and "Bereiche" and
 * "Farben" became one row per domain (forgejo#321).
 */
export const SECTION_ALIASES: Readonly<Record<string, SettingsSectionId>> = {
  apiKeys: "externalServices",
  apikeys: "externalServices",
  lodgingMemberships: "loyalty",
  flightMemberships: "loyalty",
  cruiseMemberships: "loyalty",
  domainColors: "domains",
  modules: "domains",
};

/**
 * Pages that no longer exist, and the section that took their content: a
 * bookmark of the page alone still lands on what it showed. "Unterkünfte"
 * held only the geocoder, which moved to Administration › Instanz.
 */
export const REMOVED_PAGES: Readonly<Record<string, string>> = {
  lodging: "lodgingPreferences",
};

/** Where Einstellungen → Bonusprogramme lives — the target of every loyalty link. */
export const LOYALTY_SETTINGS_PATH = "/settings/loyalty";
