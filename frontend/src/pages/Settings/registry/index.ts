import type { BetaFeatureKey } from "../../../config/betaFeatures";
import type { DomainKey } from "../../../shared/domains";
import { REGISTRY_PAGES } from "./data";
import type { RegistryPage, RegistrySection, SettingsRow } from "./types";

export type {
  RegistryGroup,
  RegistryPage,
  RegistrySection,
  SettingAudience,
  SettingKind,
  SettingScope,
  SettingsRow,
} from "./types";

/** Every page of the settings area, in the designer's order. */
export const SETTINGS_REGISTRY: readonly RegistryPage[] = REGISTRY_PAGES;

export function registryPage(id: string): RegistryPage | undefined {
  return SETTINGS_REGISTRY.find((p) => p.id === id);
}

/** What the viewing account may see: the registry's gates, answered by the caller. */
export interface RegistryAccess {
  isAdmin: boolean;
  isDomainOn: (domain: DomainKey) => boolean;
  isGateOpen: (gate: BetaFeatureKey) => boolean;
}

/**
 * A row this account can find: its page and row are not admin-only for it,
 * its domain is on and its beta key is open. The level is NOT checked — the
 * search and the expert count both look at rows the current level hides.
 *
 * A closed gate or a missing permission does filter: those are not this
 * account's to find. (An admin-only row is a status line for everyone else,
 * but a status line is not something to search for.)
 */
export function isRowFindable(
  page: RegistryPage,
  section: RegistrySection,
  row: SettingsRow,
  access: RegistryAccess
): boolean {
  if (!access.isAdmin && (page.audience === "admin" || section.audience === "admin")) return false;
  if (!access.isAdmin && row.audience === "admin") return false;
  if (page.domain && !access.isDomainOn(page.domain)) return false;
  if (row.domain && !access.isDomainOn(row.domain)) return false;
  if (section.beta && !access.isGateOpen(section.beta)) return false;
  if (row.beta && !access.isGateOpen(row.beta)) return false;
  return true;
}

/** Every row this account can find, with its place. */
export function findableRows(
  access: RegistryAccess
): Array<{ page: RegistryPage; section: RegistrySection; row: SettingsRow }> {
  return SETTINGS_REGISTRY.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.rows
        .filter((row) => isRowFindable(page, section, row, access))
        .map((row) => ({ page, section, row }))
    )
  );
}

/**
 * "Experte zeigt N weitere Einstellungen": the rows only the expert level
 * draws, among those this account can find. The registry says so per row, so
 * the number does not depend on which page is open.
 */
export function expertRowCount(access: RegistryAccess): number {
  return findableRows(access).filter((r) => r.row.level === "expert").length;
}
