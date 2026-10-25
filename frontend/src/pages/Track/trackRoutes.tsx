import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const TrackPage = lazy(() => import("./TrackPage"));

/**
 * `/track`, `/track/:date` (TravTrack plan T6) and `/track/explored` (L1), as
 * plain `<Route>` elements for App's `<Routes>` — App.tsx stands at the 800-line limit (see
 * `planRoutes.tsx`). The page itself decides whether TravTrack is offered.
 */
export function trackRoutes(isAuthenticated: boolean): JSX.Element[] {
  const day = ["/track", "/track/:date"].map((path) => (
    <Route
      key={path}
      path={path}
      element={isAuthenticated ? <TrackPage /> : <Navigate to="/login" />}
    />
  ));
  // A static segment outranks `:date`, so "explored" is never read as a day.
  const explored = (
    <Route
      key="/track/explored"
      path="/track/explored"
      element={isAuthenticated ? <TrackPage view="explored" /> : <Navigate to="/login" />}
    />
  );
  return [...day, explored];
}
