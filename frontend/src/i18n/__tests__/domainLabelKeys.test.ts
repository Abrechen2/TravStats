import { describe, expect, it } from "vitest";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";
import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";
import deDashboard from "../resources/de/dashboard.json";
import enDashboard from "../resources/en/dashboard.json";

/**
 * Ferry joined AVAILABLE_DOMAINS without `dashboard:tabStrip.tabs.ferry` or
 * `common:domain.ferry_desc`, so the disabled-tab notice read "tabStrip.tabs.ferry
 * ist ausgeschaltet" and the setup domain picker printed "domain.ferry_desc" as
 * copy. Both keys are built from the domain key at runtime, which no literal-key
 * scan can see, so every domain is enumerated here instead.
 */
function lookup(bundle: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      bundle
    );
}

const BUNDLES = {
  de: { common: deCommon, dashboard: deDashboard },
  en: { common: enCommon, dashboard: enDashboard },
} as const;

describe.each(["de", "en"] as const)("every available domain has its built labels (%s)", (lng) => {
  it.each(AVAILABLE_DOMAINS)("%s", (domain) => {
    const tab = lookup(BUNDLES[lng].dashboard, `tabStrip.tabs.${domain}`);
    const desc = lookup(BUNDLES[lng].common, `${DOMAINS[domain].i18nKey}_desc`);
    expect(typeof tab === "string" && tab.length > 0, `dashboard:tabStrip.tabs.${domain}`).toBe(
      true
    );
    expect(
      typeof desc === "string" && desc.length > 0,
      `common:${DOMAINS[domain].i18nKey}_desc`
    ).toBe(true);
  });
});
