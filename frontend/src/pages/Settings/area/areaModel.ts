import { ADMIN_PAGES, type AdminSectionId } from "../../Admin/adminSections";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../settingsModel";
import { registryPage, type RegistryArea } from "../registry";
import type { MenuGroupDef, PageDef, SectionCondition, SectionDef } from "../surface";
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
  | "profil"
  | "anzeige"
  | "reisearten"
  | "reisen"
  | "fluege"
  | "kreuzfahrten"
  | "unterkuenfte"
  | "treue"
  | "erinnerungen"
  | "freunde"
  | "telefone"
  | "dienstek"
  | "daten"
  | "ueber"
  | "tt-aufz"
  | "tt-erk"
  | "tt-daten"
  | "tt-bereit"
  | "pl-plan"
  | "pl-bereit"
  | "allgemein"
  | "nutzer"
  | "funktionen"
  | "buchungen"
  | "sicherungen"
  | "wartung"
  | "stamm";

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
  area: RegistryArea;
  /** Only an admin opens it; everyone else is sent to their own pages. */
  adminOnly: boolean;
  sections: readonly AreaSectionDef[];
}

const personalDefs = new Map<string, SectionDef<string>>(
  SETTINGS_SECTIONS.map((s) => [s.id, s] as const)
);
const adminDefs = new Map<string, SectionDef<string>>(
  ADMIN_PAGES.flatMap((p) => p.sections.map((s) => [s.id, s] as const))
);
const adminPageDomain = new Map<string, DomainKey | undefined>(
  ADMIN_PAGES.map((p) => [p.id, p.domain])
);

interface MountOptions {
  /** The heading, when the component's own does not name the registry section it stands for. */
  labelKey?: string;
  anchors?: readonly string[];
  fallbackAnchors?: readonly string[];
  matches?: readonly string[];
  /** A server-decided condition the mount waits for (TravTrack's, TravPlan's). */
  when?: SectionCondition;
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
    ...(options.labelKey ? { labelKey: options.labelKey } : {}),
    id,
    source,
    component,
    anchors: options.anchors ?? [],
    fallbackAnchors: options.fallbackAnchors ?? [],
    matches: options.matches ?? [],
    ...(options.when ? { when: options.when } : {}),
    // Whatever the server side of a mount is, only an admin sees it.
    ...(source === "admin" ? { adminOnly: true } : {}),
    ...(source === "admin" ? { domain: adminPageDomain.get(component) } : {}),
  };
}

const P = (id: SettingsSectionId, options?: MountOptions & { as?: string }): AreaSectionDef =>
  mount(options?.as ?? id, "personal", id, options);
const A = (id: AdminSectionId, options?: MountOptions & { as?: string }): AreaSectionDef =>
  mount(options?.as ?? id, "admin", id, options);

/**
 * The catalogue page is ONE mount: the 31 catalogue cards, each the target of
 * its own anchor (`#airlabs`), and every row of every card answers `?match=`.
 */
const SERVICE_SECTIONS = registryPage("dienstek")?.sections ?? [];
const SERVICE_ANCHORS = SERVICE_SECTIONS.map((s) => s.id);
const SERVICE_ROWS = SERVICE_SECTIONS.flatMap((s) => s.rows.map((r) => r.id));

/** The headings of the server's mounts: `settingsRows:<page>.sections.<section>`. */
const ROWS_LABEL = (page: string, section: string): string =>
  `settingsRows:${page}.sections.${section}`;

/**
 * A page of the registry, drawn: the mounts in the order given. What each mount
 * answers to is READ from the registry, never listed twice — a row names its
 * mount (`row.mount`), so `?match=<row>` finds it and the hash of the row's
 * group (`#<page>-<group>`) lands on it.
 */
const page = (
  id: AreaPageId,
  icon: IconName,
  sections: readonly AreaSectionDef[],
  extra: { domain?: DomainKey } = {}
): AreaPageDef => {
  const registry = registryPage(id);
  if (!registry) throw new Error(`settings area: page "${id}" is not in the registry`);
  const owned = (mountId: string): { rows: string[]; groups: string[] } => {
    const groups = registry.sections.filter((g) => g.rows.some((r) => r.mount === mountId));
    return {
      rows: groups.flatMap((g) => g.rows.filter((r) => r.mount === mountId).map((r) => r.id)),
      groups: groups.map((g) => g.id),
    };
  };
  return {
    id,
    labelKey: `settings:area.pages.${id}`,
    icon,
    area: registry.area,
    adminOnly: registry.audience === "admin",
    sections: sections.map((m) => {
      const own = owned(m.id);
      return {
        ...m,
        anchors: [...m.anchors, ...own.groups],
        matches: [...m.matches, ...own.rows],
      };
    }),
    ...extra,
  };
};

/** TravTrack's pages wait for the server's answer: held data or an offering instance. */
const TT = { when: "travTrackHeld" } as const;
/**
 * The source choice and the stay search work with Dawarich alone, so they stay
 * where an account has a Dawarich source even if the server does not offer
 * TravTrack (coordinator call, settings v3 S1/S4).
 */
const LOC = { when: "locationSourceHeld" } as const;

export const AREA_PAGES: readonly AreaPageDef[] = [
  // ---- Mein Konto
  page("profil", "user", [P("profile"), P("security"), P("apitokens"), P("deletion")]),
  page("anzeige", "languages", [
    P("display", { as: "language" }),
    P("units"),
    P("mapAppearance", { as: "views" }),
  ]),
  page("reisearten", "layers", [P("domains"), P("countryCounting"), P("home"), P("homeAirport")]),
  page("reisen", "route", [P("trips"), P("suggestions"), P("calendarFeed")]),
  page("fluege", "plane", [P("autoupdate"), P("features"), P("enrichment"), P("defaults")], {
    domain: "flight",
  }),
  page("kreuzfahrten", "ship", [P("cruisePreferences", { anchors: ["counting"] })], {
    domain: "cruise",
  }),
  // Rating categories of the stay editor, which had no page of their own since the
  // lodging settings page left (coordinator's call, settings v3).
  page("unterkuenfte", "bed", [P("lodgingRatings")], { domain: "lodging" }),
  page("treue", "credit-card", [P("loyalty")]),
  page("erinnerungen", "bell", [P("notifications", { as: "channel", anchors: ["domains"] })]),
  page("freunde", "users", [
    P("sharing", { as: "accounts", anchors: ["servers"] }),
    P("companions"),
    P("shareLinks"),
    P("comparisonConsent", { as: "compare" }),
    P("encryptedGrants"),
  ]),
  page("telefone", "smartphone", [P("devices")]),
  page("dienstek", "globe", [
    P("externalServices", { anchors: SERVICE_ANCHORS, matches: SERVICE_ROWS }),
  ]),
  page("daten", "database", [
    P("backup", { anchors: ["export"] }),
    P("import", { anchors: ["railImport"] }),
  ]),
  page("ueber", "info", [mount("about", "about", "about")]),
  // ---- TravTrack (only where the server offers it, or the account holds data)
  page("tt-aufz", "map-pin", [P("ttRecording", LOC), P("ttPlaces", TT), P("ttZones", TT)]),
  page("tt-erk", "sparkles", [P("ttDetect", LOC)]),
  page("tt-daten", "database", [
    P("ttSources", TT),
    P("ttExport", TT),
    P("ttDelete", TT),
    P("ttDiag", TT),
  ]),
  // The server's switch for TravTrack is always reachable for an admin: it is
  // where the pages above are switched on.
  page("tt-bereit", "map-pin", [
    A("travTrack", { as: "ttoffer", labelKey: ROWS_LABEL("server", "ttoffer") }),
  ]),
  // ---- TravPlan (only where the instance offers it)
  page("pl-plan", "route", [P("planning", { when: "travPlanOffered" })]),
  page("pl-bereit", "route", [
    A("travTrack", { as: "tpoffer", labelKey: ROWS_LABEL("server", "tpoffer") }),
  ]),
  // ---- Server (admin only). The pages whose rows sit inside a component that
  // draws several of the prototype's pages at once (E-Mail, Server-Verbindungen,
  // Datenschutz and Eigene Server inside the service catalogue; Adressen inside
  // the general card) are built by phase S5, when those components are split.
  page("allgemein", "settings", [
    A("instance", {
      as: "general",
      labelKey: ROWS_LABEL("server", "general"),
      anchors: ["addresses", "passkeys"],
    }),
    A("users", { as: "access", labelKey: ROWS_LABEL("users", "access") }),
  ]),
  page("nutzer", "user", [
    A("users", { as: "accounts", labelKey: ROWS_LABEL("users", "accounts") }),
    A("invitations", { labelKey: ROWS_LABEL("users", "invitations") }),
  ]),
  page("funktionen", "sliders-horizontal", [
    A("travTrack", { as: "features", labelKey: ROWS_LABEL("server", "features") }),
    A("shareLinks", { as: "shareLinksServer" }),
  ]),
  page("buchungen", "sparkles", [A("parsers", { labelKey: ROWS_LABEL("server", "parsers") })]),
  page("sicherungen", "database", [
    A("backups", { as: "automatic", labelKey: ROWS_LABEL("backups", "automatic") }),
    A("backups", { labelKey: ROWS_LABEL("backups", "backups") }),
  ]),
  page("wartung", "clock", [
    A("logging", { labelKey: ROWS_LABEL("maintenance", "logging") }),
    A("system", { labelKey: ROWS_LABEL("maintenance", "system") }),
    A("timeModel", { labelKey: ROWS_LABEL("maintenance", "timeModel") }),
  ]),
  page("stamm", "table-2", [
    A("airlinesMasterData"),
    A("aircraftMasterData"),
    A("airportsMasterData"),
    A("shipsMasterData"),
    A("portsMasterData"),
    A("lodgingChainsMasterData", { as: "chains" }),
  ]),
];

/**
 * The menu: the prototype's four areas. TravTrack and TravPlan have no entries
 * (and so no heading) while the server does not offer them; the server's are
 * drawn for an admin only.
 */
const pagesOf = (area: RegistryArea): AreaPageId[] =>
  AREA_PAGES.filter((p) => p.area === area).map((p) => p.id);

export const AREA_MENU: readonly MenuGroupDef<AreaPageId>[] = (
  ["konto", "track", "plan", "server"] as const
).map((area) => ({
  id: area,
  labelKey: `settings:area.menu.${area}`,
  pages: pagesOf(area),
}));

/** The pages shown indented under Reisearten. */
export const INDENTED_PAGES: ReadonlySet<AreaPageId> = new Set<AreaPageId>([
  "fluege",
  "kreuzfahrten",
  "unterkuenfte",
]);

export const DEFAULT_AREA_PAGE: AreaPageId = "profil";
/** Where a first visit lands (design §1) and a bare `/settings` falls back to. */
export const FIRST_VISIT_PAGE: AreaPageId = "reisearten";

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
 * groups of the page, the ids of the mounts it draws (the DOM anchors a link or
 * the chips jump to) and the aliases those mounts answer for (the old section
 * ids). Anything else is an old address and redirects.
 */
export function validAnchors(pageId: string): ReadonlySet<string> {
  const ids = new Set<string>(registryPage(pageId)?.sections.map((s) => s.id) ?? []);
  for (const s of findAreaPage(pageId)?.sections ?? []) {
    ids.add(s.id);
    for (const alias of s.anchors) ids.add(alias);
  }
  return ids;
}
