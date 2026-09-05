import type { DomainKey } from "../../shared/domains";
import type { BetaFeatureKey } from "../../config/betaFeatures";

/**
 * Settings, as routes.
 *
 * Until 2.7.0 the whole surface was one route with `?tab=` and `?section=`
 * query parameters, and the page kept four effects in sync to stop them
 * fighting each other. The owner settled it on 2026-09-05 (decision 11):
 * one route per group. A group is a destination now, so the browser owns the
 * state, the back button works, and a link is a link.
 *
 * The four general groups follow the round-3 export (Konto · Darstellung ·
 * Daten · Dienste); the three domain groups are the domain tabs that already
 * existed. Both live in the same union because both are, in the end, "which
 * page of settings am I on".
 */
export type SettingsGroupId =
  "account" | "display" | "data" | "services" | "flight" | "cruise" | "lodging";

/** Every section that can render. Ids are stable — old links carry them. */
export type SettingsSectionId =
  | "profile"
  | "security"
  | "apitokens"
  | "devices"
  | "display"
  | "units"
  | "domainColors"
  | "modules"
  | "countryCounting"
  | "backup"
  | "import"
  | "notifications"
  | "about"
  | "externalServices"
  | "homeAirport"
  | "defaults"
  | "features"
  | "enrichment"
  | "autoupdate"
  | "cruisePreferences"
  | "lodgingPreferences"
  | "lodgingMemberships";

export interface SettingsGroup {
  id: SettingsGroupId;
  /** i18n key for the group's own name, e.g. "settings:groups.account". */
  labelKey: string;
  /**
   * Set on the three domain groups. The group disappears when the domain is
   * off — the domain gate is the same one every other surface consults.
   */
  domain?: DomainKey;
  sections: SettingsSectionId[];
  /**
   * Beta keys that hide a section from view. The section still renders when a
   * URL names it directly (see `SettingsPage`): pairing a phone has no other
   * entry point while the gate is closed, and removing the escape hatch would
   * strand every claim code.
   */
  gatedSections?: Partial<Record<SettingsSectionId, BetaFeatureKey>>;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "account",
    labelKey: "settings:groups.account",
    sections: ["profile", "security", "apitokens", "devices"],
    gatedSections: { devices: "devicePairing" },
  },
  {
    id: "display",
    labelKey: "settings:groups.display",
    sections: ["display", "units", "domainColors", "modules", "countryCounting"],
  },
  {
    id: "data",
    labelKey: "settings:groups.data",
    sections: ["backup", "import", "notifications", "about"],
  },
  {
    id: "services",
    labelKey: "settings:groups.services",
    sections: ["externalServices"],
  },
  {
    id: "flight",
    labelKey: "settings:tabs.flight",
    domain: "flight",
    sections: ["homeAirport", "defaults", "features", "enrichment", "autoupdate"],
  },
  {
    id: "cruise",
    labelKey: "settings:tabs.cruise",
    domain: "cruise",
    sections: ["cruisePreferences"],
  },
  {
    id: "lodging",
    labelKey: "settings:tabs.lodging",
    domain: "lodging",
    sections: ["lodgingPreferences", "lodgingMemberships"],
  },
] as const;

/** The four that sit behind the "Allgemein" tab, in index order. */
export const GENERAL_GROUP_IDS: readonly SettingsGroupId[] = [
  "account",
  "display",
  "data",
  "services",
];

export const DEFAULT_GROUP: SettingsGroupId = "account";

export function findGroup(id: string | undefined): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((g) => g.id === id);
}

/**
 * Which group holds a section. Built from the table above rather than written
 * out twice, so a section moved between groups cannot leave a stale mapping
 * behind — the failure mode of the old alias list.
 */
export function groupOfSection(section: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((g) => (g.sections as readonly string[]).includes(section));
}
