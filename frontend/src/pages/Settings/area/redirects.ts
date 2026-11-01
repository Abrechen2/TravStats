import { MAP_PANEL_PARAM, MAP_PANEL_ROUTES } from "../../../lib/mapRoutes";
import { normalizeSectionId } from "../../../lib/sectionAliases";
import type { DomainKey } from "../../../shared/domains";
import { ADMIN_PAGES, adminPageOfTab, findAdminPage } from "../../Admin/adminSections";
import { REMOVED_PAGES, SECTION_ALIASES } from "../settingsModel";
import { registryPage, SETTINGS_REGISTRY } from "../registry";
import { lookup, pageOfSection } from "../surface";
import {
  DEFAULT_AREA_PAGE,
  FIRST_VISIT_PAGE,
  findAreaPage,
  validAnchors,
  type AreaPageId,
} from "./areaModel";

/**
 * Every settings and admin address ever written, resolved to where it lives in
 * the one settings area (design `Einstellungen-Konzept.md` §6).
 *
 * `/settings/<page>?<query>#<section>` is canonical. Older links carried the
 * section as `?section=` or `?tab=`, and admin lived under `/admin/...`; all of
 * them still arrive, from bookmarks, issue bodies and changelogs, and each must
 * land where it meant. One pure function answers, so a test can walk the whole
 * table; the page only compares its answer with the address it was opened at.
 */

/** Pages only an admin opens. */
const ADMIN_AREA_PAGES: ReadonlySet<string> = new Set(
  SETTINGS_REGISTRY.filter((p) => p.audience === "admin").map((p) => p.id)
);

/** Where an admin-only address sends an account that is not an admin. */
const OWN_FALLBACK: Readonly<Record<string, AreaPageId>> = { backups: "data" };

export interface AddressInput {
  /** `/settings`, `/settings/<page>`, `/admin` or `/admin/<page>`. */
  pathname: string;
  /** With its leading `?`, or empty. */
  search: string;
  /** With its leading `#`, or empty. */
  hash: string;
  isAdmin: boolean;
  isDomainOn: (domain: DomainKey) => boolean;
  /** The page the account was last on, if it kept one. */
  lastPage: string | null;
}

export interface ResolvedAddress {
  /** `path?query#hash`, the canonical form of the address. */
  to: string;
  /** An admin-only address was opened by an account without the permission. */
  adminOnly: boolean;
}

interface Target {
  /** An address outside the area (the map panel, the flights table). */
  external?: string;
  page?: string;
  section?: string;
  match?: string;
  service?: string;
  expert?: boolean;
}

const SERVICE_OF_SECTION: Readonly<Record<string, string>> = {
  usageStats: "usageStats",
  federation: "federation",
  push: "push",
  templateRepo: "updatesTemplates",
  smtp: "smtp",
  webdav: "webdav",
};

/** Old admin section -> its place (§6.1). A page address without a hash drops it. */
const ADMIN_TARGETS: Readonly<Record<string, Target>> = {
  instance: { page: "server", section: "general" },
  travTrack: { page: "server", section: "features", match: "ttoffer" },
  travPlan: { page: "server", section: "features", match: "tpoffer" },
  shareLinks: { page: "sharing", section: "shareLinks", match: "linkserlaubt" },
  importMode: { page: "server", section: "features", match: "importmodus" },
  about: { page: "about" },
  users: { page: "users", section: "accounts" },
  invitations: { page: "users", section: "invitations" },
  externalServices: { page: "services" },
  parsers: { page: "server", section: "parsers" },
  backups: { page: "backups" },
  timeModel: { page: "maintenance", section: "timeModel" },
  logging: { page: "maintenance", section: "logging" },
  system: { page: "maintenance", section: "system" },
  airlinesMasterData: { page: "masterdata", section: "catalogues", match: "md_airlines" },
  aircraftMasterData: { page: "masterdata", section: "catalogues", match: "md_aircraft" },
  airportsMasterData: { page: "masterdata", section: "catalogues", match: "md_airports" },
  shipsMasterData: { page: "masterdata", section: "catalogues", match: "md_ships" },
  portsMasterData: { page: "masterdata", section: "catalogues", match: "md_ports" },
  lodgingChainsMasterData: { page: "masterdata", section: "catalogues", match: "md_chains" },
};

const GEOCODER_TARGET: Target = { page: "services", service: "geocoder", expert: true };

const first = (...values: Array<string | null | undefined>): string | null =>
  values.find((v) => v) ?? null;

function adminTarget(
  pageSeg: string | undefined,
  section: string | null,
  tab: string | null
): Target {
  const raw = normalizeSectionId(section);
  if (raw === "geocoder") return GEOCODER_TARGET;
  // The bare Administration address (§6.2) is the Server page, not its first card.
  if (!pageSeg && !raw && (!tab || tab === "general")) return { page: "server" };
  const owner = raw ? pageOfSection(ADMIN_PAGES, raw) : undefined;
  const page =
    owner ??
    findAdminPage(pageSeg) ??
    (pageSeg ? undefined : findAdminPage(adminPageOfTab(tab))) ??
    findAdminPage("instance")!;
  // Without a hash, the page stands for its first section (`/admin/parsers`).
  const id = owner && raw ? raw : page.sections[0].id;
  const service = lookup(SERVICE_OF_SECTION, id);
  if (service) return { page: "services", service };
  return lookup(ADMIN_TARGETS, id) ?? { page: "server", section: "general" };
}

/** Old personal sections whose place is not the first page that lists the id. */
function settingsSectionTarget(raw: string, input: AddressInput): Target | undefined {
  switch (raw) {
    case "display":
      return { page: "display", section: "language" };
    case "mapAppearance":
      return { external: `/dashboard?${MAP_PANEL_PARAM}=${MAP_PANEL_ROUTES}` };
    case "dashboardAppearance":
      return { external: "/dashboard" };
    case "listAppearance":
      return input.isDomainOn("flight")
        ? { external: "/flights" }
        : { page: "display", section: "views" };
    case "sharing":
      return { page: "sharing", section: "accounts" };
    case "comparisonConsent":
      return { page: "sharing", section: "compare", match: "rangliste" };
    case "encryptedGrants":
      return { page: "sharing", section: "compare", match: "verschl" };
    case "dawarich":
      return { page: "services", service: "dawarich" };
    case "tripRecording":
      return { page: "location", section: "locationProvider", match: "aufz" };
    case "notifications":
      return { page: "notifications" };
    case "externalServices":
      return { page: "services" };
    case "features":
      return { page: "flight", section: "features" };
    case "lodgingPreferences":
      return input.isAdmin ? GEOCODER_TARGET : { page: "display" };
    case "admin":
      return { page: input.isAdmin ? "server" : "account" };
    default:
      return undefined;
  }
}

/** The first page that lists an id as a section or an alias of one. */
function ownerOfAnchor(anchor: string): string | undefined {
  return SETTINGS_REGISTRY.map((p) => p.id).find((id) => validAnchors(id).has(anchor));
}

function settingsTarget(
  pageSeg: string | undefined,
  section: string | null,
  tab: string | null,
  input: AddressInput
): Target {
  // A removed page named without a section stands for the section that took
  // its content — as the page itself or, pre-2.7, as `?tab=`.
  const removed = pageSeg ?? tab ?? undefined;
  const fromRemoved = removed ? lookup(REMOVED_PAGES, removed) : undefined;
  const named = first(section, fromRemoved);
  const raw = named ? (lookup(SECTION_ALIASES, named) ?? named) : null;

  if (raw) {
    // A page of the area that lists the id keeps it.
    if (pageSeg && findAreaPage(pageSeg) && validAnchors(pageSeg).has(raw)) {
      return { page: pageSeg, section: raw };
    }
    const special = settingsSectionTarget(raw, input);
    if (special) return special;
    const owner = ownerOfAnchor(raw);
    if (owner) return { page: owner, section: raw };
  }

  const pageId = pageSeg ?? tab ?? undefined;
  if (pageId && findAreaPage(pageId)) return { page: pageId };
  if (pageId === "views") return { page: "display", section: "views" };
  if (pageId === "privacy") return { page: "sharing" };
  if (pageId === "companions") return { page: "sharing", section: "companions" };
  if (pageId) return { page: DEFAULT_AREA_PAGE };

  const last = input.lastPage && findAreaPage(input.lastPage) ? input.lastPage : null;
  return { page: last ?? FIRST_VISIT_PAGE };
}

/** The hash as a section id; a malformed escape (`#%`) names nothing rather than throwing. */
function decodedHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return null;
  }
}

/** The canonical form of an address: `path?query#hash`, in a fixed order. */
export function resolveAddress(input: AddressInput): ResolvedAddress {
  const segments = input.pathname.split("/").filter(Boolean);
  const fromAdmin = segments[0] === "admin";
  const pageSeg = segments[1];
  const params = new URLSearchParams(input.search);
  const hashSection = decodedHash(input.hash);
  const section = first(params.get("section"), hashSection);
  const tab = params.get("tab");

  const target = fromAdmin
    ? adminTarget(pageSeg, section, tab)
    : settingsTarget(pageSeg, section, tab, input);
  if (target.external) return { to: target.external, adminOnly: false };

  let page = target.page ?? DEFAULT_AREA_PAGE;
  let sectionId = target.section;
  let adminOnly = fromAdmin && !input.isAdmin && page !== "about";
  let fallback = false;
  if (ADMIN_AREA_PAGES.has(page) && !input.isAdmin) {
    // The next page of the account's own, with the line that says why.
    page = OWN_FALLBACK[page] ?? DEFAULT_AREA_PAGE;
    fallback = true;
    adminOnly = true;
  }
  // A page whose ONLY section bears its name is its address (`/settings/loyalty`).
  const only = registryPage(page)?.sections;
  if (fallback || (sectionId === page && only?.length === 1)) sectionId = undefined;

  const query = new URLSearchParams();
  if (fallback) return { to: `/settings/${page}`, adminOnly };
  const service = first(target.service, page === "services" ? params.get("service") : null);
  if (service) query.set("service", service);
  const user = page === "users" ? params.get("user") : null;
  if (user) query.set("user", user);
  const match = first(target.match, params.get("match"));
  if (match) query.set("match", match);
  if (target.expert || params.get("expert") === "1") query.set("expert", "1");

  const search = query.toString();
  return {
    to: `/settings/${page}${search ? `?${search}` : ""}${sectionId ? `#${sectionId}` : ""}`,
    adminOnly,
  };
}
