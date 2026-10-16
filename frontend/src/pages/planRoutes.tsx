import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const TravPlanPage = lazy(() => import("./TravPlanRoute"));

/**
 * The three `/plan*` routes, as plain `<Route>` elements for App's `<Routes>` (React Router
 * accepts an array there; it would not accept a component wrapping them). Moved out of App.tsx,
 * which stands at the 800-line limit, to make room for the `/encrypted-share` path on
 * 2026-10-16.
 */
export function planRoutes(isAuthenticated: boolean): JSX.Element[] {
  return ["/plan", "/plan/admin", "/plan/:tripId/:section?"].map((path) => (
    <Route
      key={path}
      path={path}
      element={isAuthenticated ? <TravPlanPage /> : <Navigate to="/login" />}
    />
  ));
}
