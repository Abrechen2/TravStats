import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const TrackPage = lazy(() => import("./TrackPage"));

/**
 * `/track` and `/track/:date` (TravTrack plan T6), as plain `<Route>` elements
 * for App's `<Routes>` — App.tsx stands at the 800-line limit (see
 * `planRoutes.tsx`). The page itself decides whether TravTrack is offered.
 */
export function trackRoutes(isAuthenticated: boolean): JSX.Element[] {
  return ["/track", "/track/:date"].map((path) => (
    <Route
      key={path}
      path={path}
      element={isAuthenticated ? <TrackPage /> : <Navigate to="/login" />}
    />
  ));
}
