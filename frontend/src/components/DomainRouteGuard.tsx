import { Navigate } from "react-router-dom";
import type { JSX, ReactNode } from "react";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";
import NavigationBar from "./NavigationBar";

/**
 * Route guard for a domain page — three states, not two.
 *
 * `/flights`, `/cruises` and `/lodging` used to guard with a plain
 * `isAuthenticated && isEnabled("…")`. That reads `enabledDomains` before the
 * settings fetch has answered, and the store's own initial value is
 * `["flight"]`, so a cold load of a domain the user really has redirected
 * straight to `/`. Measured on 2026-08-25: with only `["flight"]` in the
 * persisted store, a direct load of `/cruises` bounced while the server said
 * cruises were enabled. Bookmarks, shared links and F5 all hit exactly that.
 *
 * `/places` had already learned this and grew `PlacesRouteGuard`; the comment
 * beside it names the same bug. This is that guard generalised, so the four
 * domains stop answering the question differently.
 *
 * POI keeps its own guard because its answer also depends on the beta flag —
 * a second unknown with its own pending state.
 */
export function DomainRouteGuard({
  domain,
  children,
}: {
  domain: DomainKey;
  children: ReactNode;
}): JSX.Element {
  const { isEnabled } = useEnabledDomains();
  const loaded = useSettingsStore((s) => s.enabledDomainsLoaded);
  const { t } = useTranslation(["common"]);

  if (!loaded) {
    return (
      <>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </>
    );
  }

  if (!isEnabled(domain)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
