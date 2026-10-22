import { lazy } from "react";
import type { JSX } from "react";
import { Navigate, Route } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { DomainRouteGuard } from "../components/DomainRouteGuard";
import { BAHN_HANDOFF_PATH } from "../lib/rail/bahnBookmarklet";
import { pendingBahnHandoffPath, stashBahnHandoff } from "../lib/rail/bahnHandoff";
import { useAuthStore } from "../store/authStore";

const RailBahnHandoffPage = lazy(() => import("./RailBahnHandoffPage"));

/**
 * Signed out when the bookmarklet arrives: keep the hand-over for after the
 * login, then go there. The login lands on `/`, which sends a waiting
 * hand-over back to its page (`pendingBahnHandoffPath`).
 */
function StashThenLogin(): JSX.Element {
  // Stashed while rendering, not in an effect: `<Navigate>`'s own effect runs
  // first and drops the fragment. Idempotent, so a second render is harmless.
  stashBahnHandoff(window.location.hash, Date.now());
  return <Navigate to="/login" replace />;
}

/**
 * `/` — the dashboard, unless a hand-over is waiting for the login that just
 * happened (every login path lands here).
 */
export function HomeRedirect(): JSX.Element {
  const account = useAuthStore((s) => s.user?.id ?? null);
  return <Navigate to={pendingBahnHandoffPath(Date.now(), account) ?? "/dashboard"} replace />;
}

/**
 * The bookmarklet's landing route (forgejo#204), as a plain `<Route>` for
 * App's `<Routes>` — App.tsx stands at the 800-line limit. The same two gates
 * as every rail page, outer first: the `railDomain` beta switch, then the
 * user's own domain choice.
 */
export function railHandoffRoutes(isAuthenticated: boolean): JSX.Element {
  return (
    <Route
      key={BAHN_HANDOFF_PATH}
      path={BAHN_HANDOFF_PATH}
      element={
        isAuthenticated ? (
          <BetaFeatureRouteGuard feature="railDomain" redirectTo="/dashboard">
            <DomainRouteGuard domain="rail">
              <RailBahnHandoffPage />
            </DomainRouteGuard>
          </BetaFeatureRouteGuard>
        ) : (
          <StashThenLogin />
        )
      }
    />
  );
}
