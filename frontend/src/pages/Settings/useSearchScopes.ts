import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { SETTINGS_PAGES } from "./settingsModel";
import { ADMIN_PAGES } from "../Admin/adminSections";
import type { PageDef } from "./surface";
import type { SettingsSearchScope } from "./SettingsSearch";

/**
 * Sections with rows only the expert level draws, so their words are searched
 * as expert hits (`<ns>:search.expertKeywords.<id>`).
 */
const WITH_EXPERT_ROWS: ReadonlySet<string> = new Set([
  "settings:suggestions",
  "settings:autoupdate",
  "settings:backup",
  "settings:externalServices",
  "admin:instance",
  "admin:parsers",
  "admin:externalServices",
]);

/** Sections that fold their rows into collapsed groups (the services accordion). */
const FOLDS_ROWS: ReadonlySet<string> = new Set([
  "settings:externalServices",
  "admin:externalServices",
]);

/**
 * What the settings search looks through: every page this account can reach,
 * personal and — for an admin — administration, with every section that may
 * show there AT ANY LEVEL. The level is the search's to explain, not to
 * filter: a hidden setting is still a setting.
 *
 * A closed beta gate or a missing permission does filter: those sections are
 * not this account's to find.
 */
export function useSearchScopes(isAdmin: boolean): SettingsSearchScope[] {
  const { t } = useTranslation(["settings", "admin"]);
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();

  return useMemo(() => {
    const scopesOf = (pages: readonly PageDef[], base: string, ns: "settings" | "admin") =>
      pages
        .filter((p) => !p.domain || isEnabled(p.domain))
        .map((p) => ({
          path: `${base}/${p.id}`,
          label: t(p.labelKey),
          sections: p.sections
            .filter((s) => (!s.gate || isFeatureVisible(s.gate)) && (!s.adminOnly || isAdmin))
            .map((s) => ({
              id: s.id,
              labelKey: s.labelKey,
              keywordsKey: `${ns}:search.keywords.${s.id}`,
              expertKeywordsKey: WITH_EXPERT_ROWS.has(`${ns}:${s.id}`)
                ? `${ns}:search.expertKeywords.${s.id}`
                : undefined,
              expert: s.level === "expert",
              foldsRows: FOLDS_ROWS.has(`${ns}:${s.id}`),
            })),
        }));
    return [
      ...scopesOf(SETTINGS_PAGES, "/settings", "settings"),
      ...(isAdmin ? scopesOf(ADMIN_PAGES, "/admin", "admin") : []),
    ];
  }, [t, isEnabled, isFeatureVisible, isAdmin]);
}
