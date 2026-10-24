import { normalizeSectionId } from "../../lib/sectionAliases";
import { lookup, type MenuGroupDef, type PageDef, type SectionDef } from "../Settings/surface";
import type { SettingsLevel } from "../../store/settingsLevelStore";

/**
 * Administration, as pages (forgejo#321) — the same shape as personal settings
 * (`pages/Settings/settingsModel.ts`), one route per menu entry:
 * `/admin/<page>?section=<id>`.
 *
 * Page ids are the section ids the admin page used before, so a link that
 * named `?section=logging` names the page now; a page with several sections
 * keeps its old id on the first of them.
 */
export type AdminPageId =
  | "instance"
  | "users"
  | "invitations"
  | "externalServices"
  | "parsers"
  | "smtp"
  | "backups"
  | "timeModel"
  | "logging"
  | "system"
  | "airlinesMasterData"
  | "aircraftMasterData"
  | "airportsMasterData"
  | "shipsMasterData"
  | "portsMasterData"
  | "lodgingChainsMasterData";

export type AdminSectionId =
  | "instance"
  | "travTrack"
  | "shareLinks"
  | "importMode"
  | "usageStats"
  | "about"
  | "federation"
  | "push"
  | "users"
  | "invitations"
  | "externalServices"
  | "parsers"
  | "templateRepo"
  | "smtp"
  | "backups"
  | "webdav"
  | "timeModel"
  | "logging"
  | "system"
  | "airlinesMasterData"
  | "aircraftMasterData"
  | "airportsMasterData"
  | "shipsMasterData"
  | "portsMasterData"
  | "lodgingChainsMasterData";

/** Kept for the section switch, which is about wiring, not navigation. */
export type ActiveSection = AdminSectionId;

export type AdminSectionDef = SectionDef<AdminSectionId>;
export type AdminPageDef = PageDef<AdminPageId, AdminSectionId>;

/** The heading of each section — its menu entry, chip and search title. */
export const ADMIN_SECTION_LABEL_KEY: Record<AdminSectionId, string> = {
  instance: "admin:instance.title",
  travTrack: "admin:travTrack.title",
  shareLinks: "sharing:links.section.title",
  importMode: "admin:importMode.title",
  usageStats: "usageStats:admin.title",
  about: "settings:about.title",
  federation: "admin:federation.title",
  push: "pushRelay:title",
  users: "admin:pages.users",
  invitations: "admin:pages.invitations",
  externalServices: "admin:pages.externalServices",
  parsers: "admin:parserSettings.title",
  templateRepo: "admin:templateRepo.title",
  smtp: "admin:pages.smtp",
  backups: "admin:backup.title",
  webdav: "admin:webdav.title",
  timeModel: "admin:pages.timeModel",
  logging: "admin:pages.logging",
  system: "admin:pages.system",
  airlinesMasterData: "admin:pages.airlinesMasterData",
  aircraftMasterData: "admin:pages.aircraftMasterData",
  airportsMasterData: "admin:pages.airportsMasterData",
  shipsMasterData: "admin:pages.shipsMasterData",
  portsMasterData: "admin:pages.portsMasterData",
  lodgingChainsMasterData: "admin:pages.lodgingChainsMasterData",
};

const section = (
  id: AdminSectionId,
  level: SettingsLevel = "standard",
  settings?: number
): AdminSectionDef => ({
  id,
  labelKey: ADMIN_SECTION_LABEL_KEY[id],
  level,
  ...(settings === undefined ? {} : { settings }),
});

/** A page with one section of its own name. */
const single = (
  id: AdminPageId & AdminSectionId,
  icon: AdminPageDef["icon"],
  level: SettingsLevel = "standard",
  extra: Partial<AdminPageDef> = {}
): AdminPageDef => ({
  id,
  labelKey: `admin:pages.${id}`,
  icon,
  sections: [section(id, level)],
  ...extra,
});

export const ADMIN_PAGES: readonly AdminPageDef[] = [
  {
    id: "instance",
    labelKey: "admin:pages.instance",
    icon: "settings",
    sections: [
      section("instance"),
      section("travTrack"),
      section("shareLinks"),
      section("importMode"),
      section("usageStats"),
      section("about"),
      section("federation", "expert", 3),
      section("push", "expert", 1),
    ],
  },
  single("users", "user"),
  single("invitations", "mail"),
  single("externalServices", "key-round"),
  {
    id: "parsers",
    labelKey: "admin:pages.parsers",
    icon: "sparkles",
    sections: [section("parsers"), section("templateRepo", "expert", 1)],
  },
  single("smtp", "mail"),
  {
    id: "backups",
    labelKey: "admin:pages.backups",
    icon: "database",
    sections: [section("backups"), section("webdav")],
  },
  single("timeModel", "clock", "expert"),
  single("logging", "list", "expert"),
  single("system", "info", "expert"),
  single("airlinesMasterData", "plane", "expert", { domain: "flight" }),
  single("aircraftMasterData", "plane", "expert", { domain: "flight" }),
  single("airportsMasterData", "map-pin", "expert", { domain: "flight" }),
  single("shipsMasterData", "ship", "expert", { domain: "cruise" }),
  single("portsMasterData", "anchor", "expert", { domain: "cruise" }),
  // Expert like the other catalogues (the prototype drew all of them standard;
  // the build classed the catalogues expert on 2026-10-20 and this one follows).
  single("lodgingChainsMasterData", "bed", "expert", { domain: "lodging" }),
];

/**
 * The menu (owner, 2026-10-20): administration, services and operation, then
 * master data per domain — the hotel chains since forgejo#321 gave the chain
 * catalogue an admin surface (Unterkünfte › Hotelketten).
 */
export const ADMIN_MENU: readonly MenuGroupDef<AdminPageId>[] = [
  { id: "manage", labelKey: "admin:menu.manage", pages: ["instance", "users", "invitations"] },
  {
    id: "operations",
    labelKey: "admin:menu.operations",
    pages: ["externalServices", "parsers", "smtp", "backups", "timeModel", "logging", "system"],
  },
  {
    id: "masterFlight",
    labelKey: "admin:menu.masterFlight",
    pages: ["airlinesMasterData", "aircraftMasterData", "airportsMasterData"],
  },
  {
    id: "masterCruise",
    labelKey: "admin:menu.masterCruise",
    pages: ["shipsMasterData", "portsMasterData"],
  },
  {
    id: "masterLodging",
    labelKey: "admin:menu.masterLodging",
    pages: ["lodgingChainsMasterData"],
  },
];

export const DEFAULT_ADMIN_PAGE: AdminPageId = "instance";

export function findAdminPage(id: string | undefined): AdminPageDef | undefined {
  return ADMIN_PAGES.find((p) => p.id === id);
}

/**
 * The old `?tab=` values: "general" was the default tab, the two domain tabs
 * opened on their first catalogue. `externalServices` is a section, written
 * as a tab by one hand-made link (the bus routing note) — read as the page.
 */
const OLD_TABS: Readonly<Record<string, AdminPageId>> = {
  general: "instance",
  flight: "airlinesMasterData",
  cruise: "shipsMasterData",
};

/**
 * Sections that became rows of another section, and how a link to the old one
 * still lands on its content: the geocoder moved from Instanz into Externe
 * Dienste › Karten & Ortssuche (forgejo#321 prototype), where its addresses
 * are expert rows of the group.
 */
export const ADMIN_SECTION_REDIRECTS: Readonly<
  Record<string, { section: AdminSectionId; match: string; expert: boolean }>
> = {
  geocoder: { section: "externalServices", match: "Photon", expert: true },
};

/** An admin section id as links write it, aliases and all, made canonical. */
export function canonicalAdminSection(raw: string | null): string | null {
  return normalizeSectionId(raw);
}

export function adminPageOfTab(tab: string | null): AdminPageId | undefined {
  if (!tab) return undefined;
  return lookup(OLD_TABS, tab) ?? findAdminPage(canonicalAdminSection(tab) ?? undefined)?.id;
}

/**
 * Sections whose body fetches its own data on mount. `LazySection` defers a
 * listed section's real content until it has been near the viewport once —
 * on a page with several of them (Instanz), only what the reader scrolls to
 * asks the server.
 */
export const LAZY_ADMIN_SECTIONS: ReadonlySet<AdminSectionId> = new Set<AdminSectionId>([
  "instance",
  "shareLinks",
  "importMode",
  "about",
  "federation",
  "backups",
  "webdav",
  "timeModel",
  "smtp",
  "externalServices",
  "logging",
  "usageStats",
  "push",
  "shipsMasterData",
  "portsMasterData",
  "airlinesMasterData",
  "aircraftMasterData",
  "airportsMasterData",
  "lodgingChainsMasterData",
]);
