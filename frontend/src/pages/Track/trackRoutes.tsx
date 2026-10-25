import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import { TRACK_TABS } from "./trackViews";

const TrackPage = lazy(() => import("./TrackPage"));

/**
 * `/track`, `/track/:date` (TravTrack plan T6), `/track/explored` (L1) and
 * `/track/months` (L3), `/track/stays` and `/track/imports` (phase 5), as
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
  // A static segment outranks `:date`, so neither tab is ever read as a day.
  const tabs = TRACK_TABS.map((view) => (
    <Route
      key={`/track/${view}`}
      path={`/track/${view}`}
      element={isAuthenticated ? <TrackPage view={view} /> : <Navigate to="/login" />}
    />
  ));
  return [...day, ...tabs];
}
