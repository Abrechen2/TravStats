import {
  DEFAULT_PAGE,
  MOVED_TO_ADMIN,
  REMOVED_PAGES,
  SETTINGS_PAGES,
  canonicalSection,
  findPage,
  type SettingsPageDef,
} from "./settingsModel";
import {
  ADMIN_PAGES,
  DEFAULT_ADMIN_PAGE,
  adminPageOfTab,
  canonicalAdminSection,
  findAdminPage,
  type AdminPageDef,
} from "../Admin/adminSections";
import { lookup, pageOfSection } from "./surface";

/**
 * Every settings and admin address ever written, resolved to where it lives
 * now (forgejo#321).
 *
 * Settings have been one page (`/settings?tab=&section=`), one route per group
 * (`/settings/<group>?section=`), anchors on a general page
 * (`/settings/account?section=units`) and, in admin, tabs
 * (`/admin?tab=general&section=logging`). All of those are in bookmarks, issue
 * bodies and changelogs, and every one must land on the page and section it
 * meant. One pure function per surface answers it, so a test can walk every
 * id the tables ever held — the components only compare its answer with the
 * address they were opened at.
 */

const query = (params: Record<string, string | null | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
};

export interface SettingsLinkInput {
  /** The `:page` route parameter; undefined on a bare `/settings`. */
  page: string | undefined;
  /** `?section=` or the hash, whichever the address carried. */
  section: string | null;
  /** The pre-2.7 `?tab=`. */
  tab: string | null;
  isAdmin: boolean;
  /** A domain page exists only while its domain is on. */
  isReachable: (page: SettingsPageDef) => boolean;
}

/** The canonical address for a personal settings link. */
export function resolveSettingsLink(input: SettingsLinkInput): string {
  const { isAdmin, isReachable } = input;
  // A removed page named without a section stands for the section that took
  // its content — as the page itself or, pre-2.7, as `?tab=`.
  const removedPage = input.page ?? input.tab;
  const fromRemoved = removedPage ? lookup(REMOVED_PAGES, removedPage) : undefined;
  const section = input.section ?? fromRemoved ?? null;
  const raw = section ? canonicalSection(section) : null;
  const reachable = (p: SettingsPageDef | undefined): SettingsPageDef | undefined =>
    p && isReachable(p) ? p : undefined;
  const named = reachable(findPage(input.page));

  // `?section=admin` opened a section whose only content was a link to /admin.
  if (raw === "admin") return isAdmin ? "/admin" : `/settings/${DEFAULT_PAGE}`;

  const moved = raw ? lookup(MOVED_TO_ADMIN, raw) : undefined;
  if (raw && moved) {
    if (isAdmin) return `/admin/${moved.page}${query({ section: moved.section })}`;
    // About moved with nothing personal left in it: the version is in the menu.
    if (raw === "about") return `/settings/${named?.id ?? DEFAULT_PAGE}`;
    // A permission, explained on the page rather than silently dropped.
    return `/settings/${named?.id ?? DEFAULT_PAGE}${query({ section: raw })}`;
  }

  const home = raw ? pageOfSection(SETTINGS_PAGES, raw) : undefined;
  if (raw && home) {
    const target = reachable(home);
    return target
      ? `/settings/${target.id}${query({ section: raw })}`
      : `/settings/${DEFAULT_PAGE}`;
  }

  if (named) return `/settings/${named.id}`;
  if (!input.page && input.tab) {
    const fromTab = reachable(findPage(input.tab));
    if (fromTab) return `/settings/${fromTab.id}`;
  }
  return `/settings/${DEFAULT_PAGE}`;
}

export interface AdminLinkInput {
  page: string | undefined;
  section: string | null;
  tab: string | null;
  /** `?user=` — the account a link into user management meant; carried along. */
  user: string | null;
  /**
   * `?expert=1` — the link asks for the section's expert rows (a search hit on
   * one). Carried along, and it keeps even a page's first section named, since
   * the rows are revealed for the section the address names.
   */
  expert?: boolean;
  isReachable: (page: AdminPageDef) => boolean;
}

/** The canonical address for an admin link. */
export function resolveAdminLink(input: AdminLinkInput): string {
  const reachable = (p: AdminPageDef | undefined): AdminPageDef | undefined =>
    p && input.isReachable(p) ? p : undefined;
  const section = canonicalAdminSection(input.section);
  const home = section ? reachable(pageOfSection(ADMIN_PAGES, section)) : undefined;
  const named = reachable(findAdminPage(input.page));
  const fromTab = input.page ? undefined : reachable(findAdminPage(adminPageOfTab(input.tab)));

  const page = home ?? named ?? fromTab ?? findAdminPage(DEFAULT_ADMIN_PAGE)!;
  // The section a page's first card answers to is the page itself: naming it
  // adds nothing, and a bare page address is the canonical one — unless the
  // link asks for that section's expert rows, which need it named.
  const keepSection =
    home !== undefined && (section !== page.id || input.expert === true) ? section : null;
  const expert = keepSection !== null && input.expert === true ? "1" : null;
  return `/admin/${page.id}${query({ section: keepSection, expert, user: input.user })}`;
}
