import { normalizeSectionId } from "../../lib/sectionAliases";
import { lookup, type PageDef, type SectionDef } from "../Settings/surface";
import type { SettingsLevel } from "../../store/settingsLevelStore";

/**
 * Administration's sections, and the pages of the OLD `/admin/<page>` surface.
 * The page table is kept for one reason: every old address
 * (`/admin/<page>?section=<id>`) must still land in the settings area, and
 * `area/redirects.ts` reads it to find which old page held a section. The menu
 * and the routes of that surface are gone.
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
  | "travPlan"
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
  travPlan: "admin:travPlan.title",
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
      { ...section("instance"), expertRows: true },
      section("travTrack"),
      // TravPlan's server switch (owner, 2026-10-26): shown only while its beta
      // key is open — the server refuses every plan path otherwise.
      { ...section("travPlan"), gate: "travPlan" },
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
  {
    id: "externalServices",
    labelKey: "admin:pages.externalServices",
    icon: "key-round",
    sections: [{ ...section("externalServices"), expertRows: true, foldsRows: true }],
  },
  {
    id: "parsers",
    labelKey: "admin:pages.parsers",
    icon: "sparkles",
    sections: [{ ...section("parsers"), expertRows: true }, section("templateRepo", "expert", 1)],
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
 * on a page with several of them, only what the reader scrolls to asks the server.
 * The server pages of the settings area load their own few requests at once.
 * Since settings v3 S5 the mail, services, connections and privacy sections are
 * each the content of a page of their own, not one of eight below the fold.
 */
export const LAZY_ADMIN_SECTIONS: ReadonlySet<AdminSectionId> = new Set<AdminSectionId>([
  "shareLinks",
  "about",
  "webdav",
  "shipsMasterData",
  "portsMasterData",
  "airlinesMasterData",
  "aircraftMasterData",
  "airportsMasterData",
  "lodgingChainsMasterData",
]);
