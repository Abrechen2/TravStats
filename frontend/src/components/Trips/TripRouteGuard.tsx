import type { JSX, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import NavigationBar from "../NavigationBar";

/**
 * Route guard for `/trips/:id/route/:routeId` (the tour route editor).
 *
 * Exists for the same reason `PlacesRouteGuard` does: a boolean guard cannot
 * express "not known yet". `betaFeaturesEnabled` is instance state fetched
 * from `GET /settings` and is deliberately never persisted to localStorage
 * (see the `partialize` in `store/settingsStore.ts`), so on a cold load it is
 * `null` for one request. `isFeatureVisible("tourRoutes")` reads that `null`
 * as "no" and a plain `isAuthenticated && isFeatureVisible(...)` guard
 * redirected to /trips on EVERY hard load of the editor URL — a refresh, a
 * pasted link, a bookmark — even though the session was perfectly valid and
 * the Touren tab (gated the same way, but rendered from inside a page that
 * has already loaded settings) worked fine.
 *
 * While the answer is pending this renders the app chrome and nothing else.
 * That is deliberately not a redirect and not an error: the user asked for
 * this page, the app simply does not yet know whether it may show it.
 */
export function TripRouteGuard({ children }: { children: ReactNode }): JSX.Element {
  const { betaFeaturesEnabled, isFeatureVisible } = useBetaFeatures();
  const { t } = useTranslation(["common"]);

  if (betaFeaturesEnabled === null) {
    return (
      <>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </>
    );
  }

  if (!isFeatureVisible("tourRoutes")) return <Navigate to="/trips" replace />;

  return <>{children}</>;
}
