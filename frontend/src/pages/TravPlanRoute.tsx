import { Navigate, useLocation } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useTravPlanCapabilities } from "../hooks/useTravPlanVisible";
import TravPlanPage from "./TravPlanPage";

/** Where the account's TravPlan switch lives: Einstellungen → Darstellung → Bereiche & Farben. */
const TRAVPLAN_SWITCH_PATH = "/settings/display";

/**
 * The account's own half (owner, 2026-10-27): an account that switched
 * TravPlan off is sent to the switch instead of meeting `PLAN_USER_DISABLED`
 * on every request. Waits for the answer so no plan is asked for first; a
 * failed answer lets the page through, and the server decides. `/plan/admin`
 * holds the instance's limits, so an admin's own switch does not lock it.
 */
function AccountGate() {
  const caps = useTravPlanCapabilities();
  const { pathname } = useLocation();
  if (caps === undefined) return null;
  if (caps?.userEnabled === false && !pathname.startsWith("/plan/admin"))
    return <Navigate to={TRAVPLAN_SWITCH_PATH} replace />;
  return <TravPlanPage />;
}

/**
 * The `/plan*` routes behind the `travPlan` beta switch. They used to render
 * for any session. A file of its own, loaded lazily by App.tsx, because
 * App.tsx stands at the 800-line limit; `TravPlanPage.route.test.tsx` drives
 * the guard through App's own router, so moving it out of App loses nothing.
 */
export default function TravPlanRoute() {
  return (
    <BetaFeatureRouteGuard feature="travPlan" redirectTo="/dashboard">
      <AccountGate />
    </BetaFeatureRouteGuard>
  );
}
