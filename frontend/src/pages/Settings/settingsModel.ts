import { SECTION_LABEL_KEY } from "./sectionLabels";
import { lookup, type MenuGroupDef, type PageDef, type SectionDef } from "./surface";
import type { SettingsLevel } from "../../store/settingsLevelStore";

/**
 * Personal settings, as pages (forgejo#321).
 *
 * One route per menu entry, `/settings/<page>`, and the page's sections as
 * anchors on it (`?section=<id>`). Until 2.7.x the general groups were anchors
 * on ONE long "Allgemein" page, so a menu entry was a scroll position and the
 * menu highlight followed the scroll; testers lost their place on it, and found
 * headings there that the menu never named. A page per entry ends both.
 *
 * Each section carries its level. Standard is what a person needs to set
 * TravStats up and use it; expert is tuning, plumbing and operations — the
 * classification the owner decided on 2026-10-20 (forgejo#321, first comment).
 */
export type SettingsPageId =
  | "account"
  | "display"
  | "trips"
  | "location"
  | "loyalty"
  | "flight"
  | "cruise"
  | "data"
  | "services";

/** Every section that can render. Ids are stable — links carry them. */
export type SettingsSectionId =
  | "profile"
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
  | "shareLinks"
  | "calendarFeed"
  | "dawarich"
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
  | "externalServices";

export type SettingsSectionDef = SectionDef<SettingsSectionId>;
export type SettingsPageDef = PageDef<SettingsPageId, SettingsSectionId>;

const section = (
  id: SettingsSectionId,
  level: SettingsLevel = "standard",
  extra: Partial<SettingsSectionDef> = {}
): SettingsSectionDef => ({ id, labelKey: SECTION_LABEL_KEY[id], level, ...extra });

export const SETTINGS_PAGES: readonly SettingsPageDef[] = [
  {
    id: "account",
    labelKey: "settings:groups.account",
    icon: "user",
    sections: [
      section("profile"),
      section("security"),
      // Behind its beta key; `?section=devices` still shows it, because a
      // pairing code has no other place to be minted while the key is closed.
      section("devices", "standard", { gate: "devicePairing", gateYieldsToLink: true }),
      section("notifications"),
      section("apitokens", "expert"),
    ],
  },
  {
    id: "display",
    labelKey: "settings:groups.display",
    icon: "languages",
    sections: [
      section("display"),
      section("units"),
      section("domains"),
      section("countryCounting", "expert"),
    ],
  },
  {
    // Trips are no domain, so this page never hides (owner, 2026-08-23).
    id: "trips",
    labelKey: "settings:groups.trips",
    icon: "route",
    sections: [
      section("trips"),
      section("suggestions"),
      section("sharing"),
      section("shareLinks"),
      section("calendarFeed", "standard", { gate: "calendarFeed" }),
    ],
  },
  {
    // What exists today: the Dawarich source, the app's trip recording and the
    // stay scan. The native location history is a branch of its own.
    id: "location",
    labelKey: "settings:groups.location",
    icon: "map-pin",
    sections: [section("dawarich"), section("tripRecording"), section("stayScan", "expert")],
  },
  {
    // Every domain's programmes in one place (owner, 2026-09-26).
    id: "loyalty",
    labelKey: "settings:groups.loyalty",
    icon: "credit-card",
    sections: [section("loyalty")],
  },
  {
    id: "flight",
    labelKey: "settings:tabs.flight",
    icon: "plane",
    domain: "flight",
    sections: [
      section("homeAirport"),
      section("autoupdate"),
      section("features"),
      section("defaults", "expert"),
      section("enrichment", "expert"),
    ],
  },
  {
    id: "cruise",
    labelKey: "settings:tabs.cruise",
    icon: "ship",
    domain: "cruise",
    sections: [section("cruisePreferences")],
  },
  {
    id: "data",
    labelKey: "settings:groups.data",
    icon: "database",
    sections: [section("backup"), section("import")],
  },
  {
    id: "services",
    labelKey: "settings:groups.services",
    icon: "globe",
    sections: [section("externalServices")],
  },
];

/** The menu, in the order the owner set: the account first, the domains, then data. */
export const SETTINGS_MENU: readonly MenuGroupDef<SettingsPageId>[] = [
  { id: "general", labelKey: null, pages: ["account", "display", "trips", "location", "loyalty"] },
  { id: "domains", labelKey: "settings:menu.domains", pages: ["flight", "cruise"] },
  { id: "data", labelKey: null, pages: ["data", "services"] },
];

export const DEFAULT_PAGE: SettingsPageId = "account";

export function findPage(id: string | undefined): SettingsPageDef | undefined {
  return SETTINGS_PAGES.find((p) => p.id === id);
}

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
 * Sections that left personal settings for Administration › Instanz: "Über
 * TravStats" (tester, 2026-10-20) and the geocoder, which configures the
 * instance and was never an account's to change.
 */
export const MOVED_TO_ADMIN: Readonly<Record<string, { page: string; section: string }>> = {
  about: { page: "instance", section: "about" },
  lodgingPreferences: { page: "instance", section: "geocoder" },
};

/** The section an old id now answers to, or the id itself. */
export function canonicalSection(raw: string): string {
  return lookup(SECTION_ALIASES, raw) ?? raw;
}

/** Where Einstellungen → Bonusprogramme lives — the target of every loyalty link. */
export const LOYALTY_SETTINGS_PATH = "/settings/loyalty";
