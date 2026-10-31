import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useSectionConditions } from "./useSectionConditions";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { SETTINGS_PAGES } from "./settingsModel";
import { ADMIN_PAGES } from "../Admin/adminSections";
import type { PageDef } from "./surface";
import { SURFACE_LABEL_KEY } from "../../components/Settings/frame/SurfaceTabs";
import type { SettingsSearchScope } from "./SettingsSearch";

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
  const travTrackHeld = useSectionConditions().travTrackHeld === true;

  return useMemo(() => {
    const scopesOf = (pages: readonly PageDef[], base: string, ns: "settings" | "admin") =>
      pages
        .filter((p) => !p.domain || isEnabled(p.domain))
        .map((p) => ({
          path: `${base}/${p.id}`,
          label: t(p.labelKey),
          surfaceLabel: t(SURFACE_LABEL_KEY[ns]),
          sections: p.sections
            .filter(
              (s) =>
                (!s.gate || isFeatureVisible(s.gate)) &&
                (!s.adminOnly || isAdmin) &&
                (!s.when || (s.when === "travTrackHeld" && travTrackHeld))
            )
            .map((s) => ({
              id: s.id,
              labelKey: s.labelKey,
              keywordsKey: `${ns}:search.keywords.${s.id}`,
              expertKeywordsKey: s.expertRows ? `${ns}:search.expertKeywords.${s.id}` : undefined,
              expert: s.level === "expert",
              foldsRows: s.foldsRows === true,
            })),
        }));
    return [
      ...scopesOf(SETTINGS_PAGES, "/settings", "settings"),
      ...(isAdmin ? scopesOf(ADMIN_PAGES, "/admin", "admin") : []),
    ];
  }, [t, isEnabled, isFeatureVisible, travTrackHeld, isAdmin]);
}
