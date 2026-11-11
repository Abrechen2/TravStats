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
  | "ttRecording"
  | "ttPlaces"
  | "ttZones"
  | "ttDetect"
  | "ttSources"
  | "ttExport"
  | "ttDelete"
  | "ttDiag"
  | "loyalty"
  | "homeAirport"
  | "autoupdate"
  | "features"
  | "defaults"
  | "enrichment"
  | "cruisePreferences"
  | "lodgingRatings"
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
  // The prototype drops these three links; they stay reachable at the expert level until S6.
  section("mapAppearance", "expert", { settings: 3 }),
  section("trips"),
  section("suggestions"),
  section("sharing"),
  section("calendarFeed", "standard"),
  section("companions"),
  // The TravTrack page (web redesign, 2026-11-05). Recording and detection show
  // always; everything that holds or edits stored data shows while the account
  // holds TravTrack data or the instance shows TravTrack (plan T6), so export,
  // delete and token revocation stay reachable with the server switch off.
  section("ttRecording"),
  section("ttPlaces", "standard", { when: "travTrackHeld" }),
  section("ttZones", "standard", { when: "travTrackHeld" }),
  section("ttDetect"),
  section("ttSources", "standard", { when: "travTrackHeld" }),
  section("ttExport", "standard", { when: "travTrackHeld" }),
  section("ttDelete", "standard", { when: "travTrackHeld" }),
  section("ttDiag", "expert", { when: "travTrackHeld" }),
  section("dawarich"),
  section("loyalty"),
  section("shareLinks"),
  section("comparisonConsent", "standard", { gate: "comparison" }),
  section("encryptedGrants", "standard", { gate: "encryptedShare" }),
  section("homeAirport"),
  section("autoupdate", "standard", { expertRows: true }),
  section("features"),
  // "Neue Flüge starten mit": class, airline, purpose and (coordinator's call) status.
  section("defaults", "expert", { settings: 4 }),
  section("enrichment", "expert", { settings: 3 }),
  // The whole Kreuzfahrten page is expert in the prototype.
  section("cruisePreferences", "expert", { settings: 3 }),
  section("lodgingRatings"),
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
