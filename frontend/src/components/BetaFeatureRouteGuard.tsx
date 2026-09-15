import type { JSX, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { BetaFeatureKey } from "../config/betaFeatures";
import { useBetaFeatureAccess } from "../hooks/useBetaFeatures";
import { useTranslation } from "../hooks/useTranslation";
import NavigationBar from "./NavigationBar";

interface Props {
  /** The registry key (`config/betaFeatures.ts`) this route hides behind. */
  feature: BetaFeatureKey;
  /** Where a refused reader lands. The home of the nearest un-gated page. */
  redirectTo: string;
  children: ReactNode;
}

/**
 * Route guard for a page behind the instance beta switch — the third one of
 * its kind, and the one written to be reused.
 *
 * `PlacesRouteGuard` and `TripRouteGuard` each carry the same three-state
 * logic with a domain check folded in; this one is the bare rule for a route
 * that has nothing but the flag to answer to. The rule itself is in
 * `useBetaFeatureAccess` and is not restated here — see that hook for why a
 * boolean guard is wrong (the flag is `null` for one request on every cold
 * load, and a boolean reads that as "no" and bounces a bookmark).
 *
 * While the answer is pending this renders the app chrome and nothing else.
 * That is deliberately not a redirect and not an error: the user asked for
 * this page, the app simply does not yet know whether it may show it.
 */
export function BetaFeatureRouteGuard({ feature, redirectTo, children }: Props): JSX.Element {
  const access = useBetaFeatureAccess(feature);
  const { t } = useTranslation(["common"]);

  if (access === "pending") {
    return (
      <>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </>
    );
  }

  if (access === "denied") return <Navigate to={redirectTo} replace />;

  return <>{children}</>;
}
