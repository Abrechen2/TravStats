import { MAP_PANEL_PARAM, MAP_PANEL_ROUTES } from "../../../lib/mapRoutes";
import { normalizeSectionId } from "../../../lib/sectionAliases";
import type { DomainKey } from "../../../shared/domains";
import { ADMIN_PAGES, adminPageOfTab, findAdminPage } from "../../Admin/adminSections";
import { REMOVED_PAGES, SECTION_ALIASES } from "../settingsModel";
import { SETTINGS_REGISTRY } from "../registry";
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
const OWN_FALLBACK: Readonly<Record<string, AreaPageId>> = { sicherungen: "daten" };

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
  instance: { page: "allgemein", section: "general" },
  travTrack: { page: "funktionen", section: "features", match: "ttoffer" },
  travPlan: { page: "funktionen", section: "features", match: "tpoffer" },
  shareLinks: { page: "funktionen", section: "shareLinksServer", match: "linkserlaubt" },
  importMode: { page: "funktionen", section: "features", match: "importmodus" },
  about: { page: "ueber" },
  users: { page: "nutzer", section: "accounts" },
  invitations: { page: "nutzer", section: "invitations" },
  externalServices: { page: "dienstek" },
  parsers: { page: "buchungen", section: "parsers" },
  backups: { page: "sicherungen" },
  timeModel: { page: "wartung", section: "timeModel" },
  logging: { page: "wartung", section: "logging" },
  system: { page: "wartung", section: "system" },
  airlinesMasterData: { page: "stamm", section: "airlinesMasterData", match: "md_airlines" },
  aircraftMasterData: { page: "stamm", section: "aircraftMasterData", match: "md_aircraft" },
  airportsMasterData: { page: "stamm", section: "airportsMasterData", match: "md_airports" },
  shipsMasterData: { page: "stamm", section: "shipsMasterData", match: "md_ships" },
  portsMasterData: { page: "stamm", section: "portsMasterData", match: "md_ports" },
  lodgingChainsMasterData: { page: "stamm", section: "chains", match: "md_chains" },
};

/**
 * The pages of the settings area before settings v3 (S1), and the pages their
 * content now lives on, the one the bare address lands on first. A bookmark of
 * `/settings/flight#autoupdate` looks for the section on these pages only, so a
 * section id two old pages shared (`features`) still finds its own.
 */
const OLD_PAGES: Readonly<Record<string, readonly AreaPageId[]>> = {
  account: ["profil", "reisearten", "telefone"],
  display: ["anzeige"],
  domains: ["reisearten", "pl-plan"],
  flight: ["fluege", "reisearten"],
  cruise: ["kreuzfahrten"],
  trips: ["reisen"],
  sharing: ["freunde", "funktionen"],
  notifications: ["erinnerungen"],
  travtrack: ["tt-aufz", "tt-erk", "tt-daten"],
  loyalty: ["treue"],
  data: ["daten"],
  services: ["dienstek"],
  server: ["allgemein", "funktionen", "buchungen"],
  users: ["nutzer", "allgemein"],
  backups: ["sicherungen"],
  maintenance: ["wartung"],
  masterdata: ["stamm"],
  about: ["ueber"],
};

/** The page id TravTrack replaced; its addresses live on in bookmarks and changelogs. */
const OLD_LOCATION_PAGE = "location";

const GEOCODER_TARGET: Target = { page: "dienstek", service: "geocoder", expert: true };

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
  if (!pageSeg && !raw && (!tab || tab === "general")) return { page: "allgemein" };
  const owner = raw ? pageOfSection(ADMIN_PAGES, raw) : undefined;
  const page =
    owner ??
    findAdminPage(pageSeg) ??
    (pageSeg ? undefined : findAdminPage(adminPageOfTab(tab))) ??
    findAdminPage("instance")!;
  // Without a hash, the page stands for its first section (`/admin/parsers`).
  const id = owner && raw ? raw : page.sections[0].id;
  const service = lookup(SERVICE_OF_SECTION, id);
  if (service) return { page: "dienstek", service };
  return lookup(ADMIN_TARGETS, id) ?? { page: "allgemein", section: "general" };
}

/** Old personal sections whose place is not the first page that lists the id. */
function settingsSectionTarget(raw: string, input: AddressInput): Target | undefined {
  switch (raw) {
    case "display":
      return { page: "anzeige", section: "language" };
    case "mapAppearance":
      return { external: `/dashboard?${MAP_PANEL_PARAM}=${MAP_PANEL_ROUTES}` };
    case "dashboardAppearance":
      return { external: "/dashboard" };
    case "listAppearance":
      return input.isDomainOn("flight")
        ? { external: "/flights" }
        : { page: "anzeige", section: "views" };
    case "sharing":
      return { page: "freunde", section: "accounts" };
    case "comparisonConsent":
      return { page: "freunde", section: "compare", match: "rangliste" };
    case "encryptedGrants":
      return { page: "freunde", section: "encryptedGrants", match: "verschl" };
    case "dawarich":
      return { page: "dienstek", service: "dawarich" };
    // The Standort page became TravTrack (web redesign, 2026-11-05): its four
    // sections, and the "history" section that was folded into the page, moved.
    case "locationProvider":
      return { page: "tt-aufz", section: "ttRecording" };
    case "tripRecording":
      return { page: "tt-aufz", section: "ttRecording", match: "aufz" };
    case "stayScan":
      return { page: "tt-erk", section: "ttDetect" };
    case "travTrack":
      return { page: "tt-aufz", section: "ttZones" };
    case "history":
      return { page: "tt-daten", section: "ttSources" };
    case "notifications":
      return { page: "erinnerungen" };
    case "externalServices":
      return { page: "dienstek" };
    case "features":
      return { page: "fluege", section: "features" };
    case "lodgingPreferences":
      return input.isAdmin ? GEOCODER_TARGET : { page: "anzeige" };
    case "admin":
      return { page: input.isAdmin ? "allgemein" : "profil" };
    default:
      return undefined;
  }
}

/** The first page that lists an id as a section or an alias of one. */
function ownerOfAnchor(anchor: string, among?: readonly string[]): string | undefined {
  return (among ?? SETTINGS_REGISTRY.map((p) => p.id)).find((id) => validAnchors(id).has(anchor));
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

  // The old Standort page, named without a section, is the TravTrack page.
  if (!named && (pageSeg ?? tab) === OLD_LOCATION_PAGE) return { page: "tt-aufz" };

  // A page of the area as it was before settings v3: its section is looked for
  // on the pages its content moved to, and the page alone lands on the first.
  const oldPages = pageSeg ? lookup(OLD_PAGES, pageSeg) : undefined;
  if (oldPages && !findAreaPage(pageSeg)) {
    const owner = raw ? ownerOfAnchor(raw, oldPages) : undefined;
    if (owner) return { page: owner, section: raw ?? undefined };
    // A section none of its pages holds (the old tables moved some across pages
    // before) is looked up on its own, below; none named is the page itself.
    if (!raw) return { page: oldPages[0] };
  }

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
  const oldOnly = pageId ? lookup(OLD_PAGES, pageId) : undefined;
  if (oldOnly) return { page: oldOnly[0] };
  if (pageId === "views") return { page: "anzeige", section: "views" };
  if (pageId === "privacy") return { page: "freunde" };
  if (pageId === "companions") return { page: "freunde", section: "companions" };
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
  let adminOnly = fromAdmin && !input.isAdmin && page !== "ueber";
  let fallback = false;
  if (ADMIN_AREA_PAGES.has(page) && !input.isAdmin) {
    // The next page of the account's own, with the line that says why.
    page = OWN_FALLBACK[page] ?? DEFAULT_AREA_PAGE;
    fallback = true;
    adminOnly = true;
  }
  // A page drawing ONE mount: that mount's name is the page's address — unless a
  // closed gate gives way to the name alone (Telefone: `?section=devices`).
  const only = findAreaPage(page)?.sections;
  const nameIsAddress = only?.length === 1 && sectionId === only[0].id && !only[0].gateYieldsToLink;
  if (fallback || nameIsAddress) sectionId = undefined;

  const query = new URLSearchParams();
  if (fallback) return { to: `/settings/${page}`, adminOnly };
  const service = first(target.service, page === "dienstek" ? params.get("service") : null);
  if (service) query.set("service", service);
  const user = page === "nutzer" ? params.get("user") : null;
  if (user) query.set("user", user);
  const match = first(target.match, params.get("match"));
  if (match) query.set("match", match);
  if (target.expert || params.get("expert") === "1") query.set("expert", "1");
  // The map's gear carries the shown range to export and delete.
  if (page.startsWith("tt-")) {
    for (const key of ["from", "until"]) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
  }

  const search = query.toString();
  return {
    to: `/settings/${page}${search ? `?${search}` : ""}${sectionId ? `#${sectionId}` : ""}`,
    adminOnly,
  };
}
