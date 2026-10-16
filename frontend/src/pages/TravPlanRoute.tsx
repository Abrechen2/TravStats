import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import TravPlanPage from "./TravPlanPage";

/**
 * The `/plan*` routes behind the `travPlan` beta switch. They used to render
 * for any session. A file of its own, loaded lazily by App.tsx, because
 * App.tsx stands at the 800-line limit; `TravPlanPage.route.test.tsx` drives
 * the guard through App's own router, so moving it out of App loses nothing.
 */
export default function TravPlanRoute() {
  return (
    <BetaFeatureRouteGuard feature="travPlan" redirectTo="/dashboard">
      <TravPlanPage />
    </BetaFeatureRouteGuard>
  );
}
