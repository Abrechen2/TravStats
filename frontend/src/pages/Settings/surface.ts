import type { BetaFeatureKey } from "../../config/betaFeatures";
import type { DomainKey } from "../../shared/domains";
import type { IconName } from "../../components/ui/Icon";
import type { SettingsLevel } from "../../store/settingsLevelStore";

/**
 * The shape both settings surfaces share — personal settings and
 * administration (forgejo#321).
 *
 * A surface is a menu of PAGES, one per menu entry; a page holds SECTIONS, each
 * drawn as a heading and one card. The tester's complaints that started the
 * redesign were all about the two drifting apart: headings the menu did not
 * name, labels that differed from the menu, a long page whose menu entry was a
 * scroll position. One table per surface, read by the menu, the page, the
 * search and the redirects alike, is what keeps them from drifting again.
 */
export interface SectionDef<S extends string = string> {
  id: S;
  /** The heading, the anchor chip and the search title — one key for all three. */
  labelKey: string;
  /** "expert" sections are hidden at the standard level unless a link names them. */
  level: SettingsLevel;
  /** A beta key hiding the section. */
  gate?: BetaFeatureKey;
  /**
   * The gate gives way to a URL naming the section. Device pairing only: while
   * its key is closed, `?section=devices` is the one place a pairing code can
   * be minted, and removing that would strand every claim code. Every other
   * gate stays the owner's call (CLAUDE.md, beta gating).
   */
  gateYieldsToLink?: boolean;
  /** Only an admin sees it; unlike a gate, no URL lifts this. */
  adminOnly?: boolean;
  /**
   * How many settings the section holds, for the "n weitere Einstellungen"
   * note when the standard level hides it whole (forgejo#321 prototype counts
   * settings, not sections). Read off the section's component; 1 if absent.
   */
  settings?: number;
}

export interface PageDef<P extends string = string, S extends string = string> {
  id: P;
  /** The menu entry AND the page title: the same words, on purpose. */
  labelKey: string;
  icon: IconName;
  /** Present on a domain's page: it exists only while the domain is on. */
  domain?: DomainKey;
  sections: readonly SectionDef<S>[];
}

export interface MenuGroupDef<P extends string = string> {
  id: string;
  /** null draws no heading — the personal menu's first block has none. */
  labelKey: string | null;
  pages: readonly P[];
}

/** A page is expert when every one of its sections is. */
export function pageLevel(page: PageDef): SettingsLevel {
  return page.sections.every((s) => s.level === "expert") ? "expert" : "standard";
}

export interface SectionVisibilityInput {
  level: SettingsLevel;
  isGateOpen: (gate: BetaFeatureKey) => boolean;
  isAdmin: boolean;
  /** The section a URL named, if any. */
  deepLinked: string | null;
}

export interface PageSections<S extends string> {
  /** Drawn, in table order. */
  shown: S[];
  /** Expert sections the standard level keeps off this page. */
  hiddenExpert: number;
  /** The settings those hidden expert sections hold. */
  hiddenExpertSettings: number;
  /** A link named an expert section the level would hide; it is shown anyway. */
  deepLinkedExpert: S | null;
}

/**
 * Which sections of a page are drawn.
 *
 * Three independent reasons keep a section out, and only the first two give
 * way to a link: a closed beta gate where the section says so (pairing a phone
 * has no other entry point while `devicePairing` is closed), the standard level (a link to an expert
 * section must land on it, not on a page without it), and admin-only, which is
 * a permission and never yields.
 */
export function sectionsOf<S extends string>(
  page: PageDef<string, S>,
  input: SectionVisibilityInput
): PageSections<S> {
  const shown: S[] = [];
  let hiddenExpert = 0;
  let hiddenExpertSettings = 0;
  let deepLinkedExpert: S | null = null;
  for (const section of page.sections) {
    const named = input.deepLinked === section.id;
    if (section.adminOnly && !input.isAdmin) continue;
    if (section.gate && !input.isGateOpen(section.gate) && !(named && section.gateYieldsToLink)) {
      continue;
    }
    if (section.level === "expert" && input.level === "standard") {
      if (!named) {
        hiddenExpert += 1;
        hiddenExpertSettings += section.settings ?? 1;
        continue;
      }
      deepLinkedExpert = section.id;
    }
    shown.push(section.id);
  }
  return { shown, hiddenExpert, hiddenExpertSettings, deepLinkedExpert };
}

/** The page holding a section, searched in table order. */
export function pageOfSection<P extends string, S extends string>(
  pages: readonly PageDef<P, S>[],
  section: string
): PageDef<P, S> | undefined {
  return pages.find((p) => p.sections.some((s) => s.id === section));
}

/** An own-property lookup: `?section=constructor` must not find Object.prototype. */
export function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}
