import type { BetaFeatureKey } from "../../../config/betaFeatures";
import type { DomainKey } from "../../../shared/domains";
import type { SettingsLevel } from "../../../store/settingsLevelStore";

/**
 * The settings registry (settings rebuild, package 1): every setting the area
 * can show, as data. Pages, sections and rows come from the designer's
 * `settings-data.json` (round 2) through
 * `frontend/scripts/generate-settings-registry.mjs`; nothing in `data/` is
 * edited by hand.
 *
 * The registry is what the SEARCH and the "Experte zeigt N weitere" count read.
 * What a page DRAWS is the mount table in `../area/areaModel.ts` — until the
 * building blocks (packages 2 to 7) replace the old section components, a
 * registry row and a mounted component are two views of the same setting, and
 * a test pins which registry sections have no component yet.
 */

/** Who a setting applies to: one account, the whole server, or this browser. */
export type SettingScope = "account" | "instance" | "device";

/** Who sees it: every account, or admins only (others get a status line). */
export type SettingAudience = "all" | "admin";

/** The row kinds the design draws (`t` in the data). */
export type SettingKind =
  | "input"
  | "toggle"
  | "action"
  | "list"
  | "select"
  | "link"
  | "choice"
  | "secret"
  | "status"
  | "domain"
  | "danger"
  | "remind"
  | "upload";

export interface SettingsRow {
  /** Stable: links (`?match=`), tests and later the saved state carry it. */
  id: string;
  kind: SettingKind;
  level: SettingsLevel;
  scope: SettingScope;
  audience: SettingAudience;
  /** The row exists only while this domain is on. */
  domain?: DomainKey;
  /** The row is hidden behind this beta key. */
  beta?: BetaFeatureKey;
  /** Locked in the demo account. */
  demoLocked: boolean;
  de: string;
  en: string;
  /** Everything else a person might type to find it: hint, help, option names. */
  terms: { de: string; en: string };
}

export interface RegistrySection {
  /** The anchor: `/settings/<page>#<id>`. */
  id: string;
  de: string;
  en: string;
  level: SettingsLevel;
  scope: SettingScope;
  audience: SettingAudience;
  beta?: BetaFeatureKey;
  demoLocked: boolean;
  /** A service card of the catalogue (the services page): its group. */
  serviceCategory?: string;
  rows: readonly SettingsRow[];
}

export type RegistryGroup = "account" | "server" | "about";

export interface RegistryPage {
  /** The route: `/settings/<id>`. */
  id: string;
  group: RegistryGroup;
  de: string;
  en: string;
  level: SettingsLevel;
  audience: SettingAudience;
  domain?: DomainKey;
  demoLocked: boolean;
  sections: readonly RegistrySection[];
}
