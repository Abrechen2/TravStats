import type { JSX, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePlacesAccess } from "../../hooks/usePlacesVisible";
import { useTranslation } from "../../hooks/useTranslation";
import NavigationBar from "../NavigationBar";

/**
 * Route guard for the Places pages.
 *
 * Exists because a boolean guard cannot express "not known yet". The beta flag
 * is never persisted to localStorage, so on a cold load it is `null` for one
 * request — and a boolean guard reads that as "no" and redirects. The effect
 * was that /places worked when navigated to from inside the app and bounced to
 * the dashboard on a refresh, a bookmark, or a link opened in a new tab.
 *
 * While the answer is pending this renders the app chrome and nothing else.
 * That is deliberately not a redirect and not an error: the user asked for
 * this page, the app simply does not yet know whether it may show it.
 */
export function PlacesRouteGuard({ children }: { children: ReactNode }): JSX.Element {
  const access = usePlacesAccess();
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

  if (access === "denied") return <Navigate to="/" replace />;

  return <>{children}</>;
}
