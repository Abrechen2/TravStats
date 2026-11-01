import { ADMIN_PAGES, type AdminSectionId } from "../../Admin/adminSections";
import { SETTINGS_PAGES, type SettingsSectionId } from "../settingsModel";
import { registryPage, type RegistryGroup } from "../registry";
import type { MenuGroupDef, PageDef, SectionDef } from "../surface";
import type { IconName } from "../../../components/ui/Icon";
import type { DomainKey } from "../../../shared/domains";

/**
 * The settings area (settings rebuild, package 1): ONE area for the account's
 * own settings and the server's, replacing the two surfaces
 * (`/settings/*` and `/admin/*`) that grew side by side.
 *
 * Two tables meet here and must not be confused:
 *
 * - the REGISTRY (`./registry`) is what the design says exists — rows, levels,
 *   scopes, audiences. Search and the expert count read it.
 * - the MOUNTS below are what a page DRAWS today: the section components that
 *   already exist, placed on the page the design gives them. They are mounted
 *   unchanged; the building blocks of packages 2 to 7 replace them page by page.
 *
 * A mount's id is the anchor of `/settings/<page>#<id>`. It is the registry's
 * section id wherever the design has one; a mount without a registry section
 * (the two other map cards, the admin share-link switch) is reached by a row id
 * (`?match=`) instead, and `anchors` lets one mount answer for the registry
 * sections whose content it already holds.
 */
export type AreaPageId =
  | "account"
  | "display"
  | "domains"
  | "flight"
  | "cruise"
  | "trips"
  | "sharing"
  | "notifications"
  | "location"
  | "loyalty"
  | "data"
  | "services"
  | "server"
  | "users"
  | "backups"
  | "maintenance"
  | "masterdata"
  | "about";

/** Whose component draws the mount. `about` is the shared Über-TravStats card. */
export type MountSource = "personal" | "admin" | "about";

export interface AreaSectionDef extends SectionDef<string> {
  source: MountSource;
  /** The existing component: a personal or admin section id. */
  component: string;
  /** Registry section ids this mount stands in for until their block exists. */
  anchors: readonly string[];
  /**
   * Anchors it answers for only when no visible mount owns them: a service card
   * the server owns, for an account that cannot see the server's section.
   */
  fallbackAnchors: readonly string[];
  /** Row ids (`?match=`) that scroll to this mount. */
  matches: readonly string[];
  /** The mount exists only while this domain is on (master data catalogues). */
  domain?: DomainKey;
}

export interface AreaPageDef extends PageDef<AreaPageId, string> {
  group: RegistryGroup;
  /** Only an admin opens it; everyone else is sent to their own pages. */
  adminOnly: boolean;
  sections: readonly AreaSectionDef[];
}

const personalDefs = new Map<string, SectionDef<string>>(
  SETTINGS_PAGES.flatMap((p) => p.sections.map((s) => [s.id, s] as const))
);
const adminDefs = new Map<string, SectionDef<string>>(
  ADMIN_PAGES.flatMap((p) => p.sections.map((s) => [s.id, s] as const))
);
const adminPageDomain = new Map<string, DomainKey | undefined>(
  ADMIN_PAGES.map((p) => [p.id, p.domain])
);

interface MountOptions {
  anchors?: readonly string[];
  fallbackAnchors?: readonly string[];
  matches?: readonly string[];
}

const ABOUT_DEF: SectionDef<string> = {
  id: "about",
  labelKey: "settings:about.title",
  level: "standard",
};

function mount(
  id: string,
  source: MountSource,
  component: string,
  options: MountOptions = {}
): AreaSectionDef {
  const base =
    source === "personal"
      ? personalDefs.get(component)
      : source === "admin"
        ? adminDefs.get(component)
        : ABOUT_DEF;
  if (!base) throw new Error(`settings area: no ${source} section "${component}"`);
  return {
    ...base,
    id,
    source,
    component,
    anchors: options.anchors ?? [],
    fallbackAnchors: options.fallbackAnchors ?? [],
    matches: options.matches ?? [],
    // Whatever the server side of a mount is, only an admin sees it.
    ...(source === "admin" ? { adminOnly: true } : {}),
    ...(source === "admin" ? { domain: adminPageDomain.get(component) } : {}),
  };
}

const P = (id: SettingsSectionId, options?: MountOptions & { as?: string }): AreaSectionDef =>
  mount(options?.as ?? id, "personal", id, options);
const A = (id: AdminSectionId, options?: MountOptions & { as?: string }): AreaSectionDef =>
  mount(options?.as ?? id, "admin", id, options);

/** Service cards with a mount of their own (the server's own services). */
const OWN_SERVICE_MOUNTS = [
  "smtp",
  "webdav",
  "push",
  "federation",
  "usageStats",
  "updatesTemplates",
];
const SERVICE_CARDS = (registryPage("services")?.sections ?? []).filter(
  (s) => !OWN_SERVICE_MOUNTS.includes(s.id)
);
/** Cards that exist only on the server's side (every row admin-only): the instance mount's. */
const INSTANCE_ONLY_CARDS = SERVICE_CARDS.filter(
  (s) => s.rows.length > 0 && s.rows.every((r) => r.audience === "admin")
).map((s) => s.id);
const SERVICE_ANCHORS = SERVICE_CARDS.map((s) => s.id).filter(
  (id) => !INSTANCE_ONLY_CARDS.includes(id)
);

/**
 * The rows of the service cards that are the SERVER's side ("Alle Konten"):
 * they are drawn by the admin services mount, so a link or search hit naming
 * one scrolls there and reveals its expert rows, not the account's section.
 */
const INSTANCE_SERVICE_ROWS = (registryPage("services")?.sections ?? [])
  .filter((s) => !OWN_SERVICE_MOUNTS.includes(s.id))
  .flatMap((s) => s.rows.filter((r) => r.audience === "admin").map((r) => r.id));

const page = (
  id: AreaPageId,
  icon: IconName,
  sections: readonly AreaSectionDef[],
  extra: { domain?: DomainKey } = {}
): AreaPageDef => {
  const registry = registryPage(id);
  if (!registry) throw new Error(`settings area: page "${id}" is not in the registry`);
  return {
    id,
    labelKey: `settings:area.pages.${id}`,
    icon,
    group: registry.group,
    adminOnly: registry.audience === "admin",
    sections,
    ...extra,
  };
};

export const AREA_PAGES: readonly AreaPageDef[] = [
  page("account", "user", [
    P("profile"),
    P("home"),
    P("security"),
    P("devices"),
    P("apitokens"),
    P("deletion"),
  ]),
  page("display", "languages", [
    P("display", { as: "language" }),
    P("units"),
    P("mapAppearance", { as: "views", anchors: [] }),
  ]),
  page("domains", "layers", [P("domains"), P("planning"), P("countryCounting")]),
  page(
    "flight",
    "plane",
    [P("homeAirport"), P("defaults"), P("features"), P("autoupdate"), P("enrichment")],
    { domain: "flight" }
  ),
  page("cruise", "ship", [P("cruisePreferences", { anchors: ["counting"] })], {
    domain: "cruise",
  }),
  page("trips", "route", [P("trips"), P("suggestions"), P("calendarFeed")]),
  page("sharing", "users", [
    P("companions"),
    P("sharing", { as: "accounts", anchors: ["servers"] }),
    P("shareLinks"),
    A("shareLinks", { as: "shareLinksServer", matches: ["linkserlaubt"] }),
    P("comparisonConsent", { as: "compare", matches: ["rangliste"] }),
    P("encryptedGrants", { matches: ["verschl"] }),
  ]),
  page("notifications", "bell", [P("notifications", { as: "channel", anchors: ["domains"] })]),
  page("location", "map-pin", [
    P("locationProvider"),
    P("tripRecording", { matches: ["aufz"] }),
    P("stayScan"),
    P("travTrack", { anchors: ["history"] }),
  ]),
  page("loyalty", "credit-card", [P("loyalty")]),
  page("data", "database", [
    P("backup", { anchors: ["export"] }),
    P("import", { anchors: ["railImport"] }),
  ]),
  page("services", "globe", [
    P("externalServices", { anchors: SERVICE_ANCHORS, fallbackAnchors: INSTANCE_ONLY_CARDS }),
    A("externalServices", {
      as: "instanceServices",
      anchors: INSTANCE_ONLY_CARDS,
      matches: INSTANCE_SERVICE_ROWS,
    }),
    A("smtp"),
    A("webdav"),
    A("push"),
    A("federation"),
    A("usageStats"),
    A("templateRepo", { as: "updatesTemplates" }),
  ]),
  page("server", "settings", [
    A("instance", { as: "general", anchors: ["addresses", "passkeys"] }),
    A("travTrack", { as: "features", matches: ["ttoffer"] }),
    A("travPlan", { matches: ["tpoffer"] }),
    A("importMode", { matches: ["importmodus"] }),
    A("parsers"),
  ]),
  page("users", "user", [A("users", { as: "accounts" }), A("invitations")]),
  page("backups", "database", [A("backups", { anchors: ["automatic"] })]),
  page("maintenance", "clock", [A("logging"), A("system"), A("timeModel")]),
  page("masterdata", "table-2", [
    A("airlinesMasterData", { anchors: ["catalogues"], matches: ["md_airlines"] }),
    A("aircraftMasterData", { matches: ["md_aircraft"] }),
    A("airportsMasterData", { matches: ["md_airports"] }),
    A("shipsMasterData", { matches: ["md_ships"] }),
    A("portsMasterData", { matches: ["md_ports"] }),
    A("lodgingChainsMasterData", { as: "chains", matches: ["md_chains"] }),
  ]),
  page("about", "info", [mount("about", "about", "about")]),
];

/**
 * The menu: "Dein Konto", "Server · nur Admin" (admins only), and the About
 * entry below them. Flights and Cruises are indented under Reisearten and
 * appear only while their domain is on.
 */
export const AREA_MENU: readonly MenuGroupDef<AreaPageId>[] = [
  {
    id: "account",
    labelKey: "settings:area.menu.account",
    pages: [
      "account",
      "display",
      "domains",
      "flight",
      "cruise",
      "trips",
      "sharing",
      "notifications",
      "location",
      "loyalty",
      "data",
      "services",
    ],
  },
  {
    id: "server",
    labelKey: "settings:area.menu.server",
    pages: ["server", "users", "backups", "maintenance", "masterdata"],
  },
  { id: "about", labelKey: null, pages: ["about"] },
];

/** The pages shown indented under Reisearten. */
export const INDENTED_PAGES: ReadonlySet<AreaPageId> = new Set<AreaPageId>(["flight", "cruise"]);

export const DEFAULT_AREA_PAGE: AreaPageId = "account";
/** Where a first visit lands (design §1) and a bare `/settings` falls back to. */
export const FIRST_VISIT_PAGE: AreaPageId = "domains";

export function findAreaPage(id: string | undefined): AreaPageDef | undefined {
  return AREA_PAGES.find((p) => p.id === id);
}

/**
 * The mount an anchor, alias or `?match=` row id points at on a page. An account
 * without the permission is answered by a mount it can see: a service card the
 * server owns (`aviationstack`) falls back to the catalogue the account has.
 */
export function mountFor(
  pageId: string,
  anchor: string | null,
  match: string | null = null,
  isAdmin = true
): AreaSectionDef | undefined {
  const sections = (findAreaPage(pageId)?.sections ?? []).filter((s) => isAdmin || !s.adminOnly);
  if (match) {
    const byMatch = sections.find((s) => s.matches.includes(match));
    if (byMatch) return byMatch;
  }
  if (!anchor) return undefined;
  return (
    sections.find((s) => s.id === anchor || s.anchors.includes(anchor)) ??
    sections.find((s) => s.fallbackAnchors.includes(anchor))
  );
}

/**
 * The anchors `/settings/<page>#<anchor>` is canonical for: the registry's
 * sections of the page and the aliases its mounts answer for. A mount's own id
 * that is not a registry section (the two other map cards, the share-link
 * switch of the server) is NOT one: such an id is an old address and redirects.
 */
export function validAnchors(pageId: string): ReadonlySet<string> {
  const ids = new Set<string>(registryPage(pageId)?.sections.map((s) => s.id) ?? []);
  for (const s of findAreaPage(pageId)?.sections ?? []) {
    for (const alias of s.anchors) ids.add(alias);
  }
  return ids;
}
