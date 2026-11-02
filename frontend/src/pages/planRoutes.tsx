import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const TravPlanPage = lazy(() => import("./TravPlanRoute"));

/**
 * The `/plan*` routes, as plain `<Route>` elements for App's `<Routes>` (React Router
 * accepts an array there; it would not accept a component wrapping them). Moved out of App.tsx,
 * which stands at the 800-line limit, to make room for the `/encrypted-share` path on
 * 2026-10-16. A plan on another server (spec 2026-11-02 §4) is `/plan/remote/<connection>/<plan>`:
 * the same signed-in page, drawn from the member's own server.
 */
export function planRoutes(isAuthenticated: boolean): JSX.Element[] {
  return [
    "/plan",
    "/plan/admin",
    "/plan/:tripId/:section?",
    "/plan/remote/:connectionId/:planId/:section?",
  ].map((path) => (
    <Route
      key={path}
      path={path}
      element={isAuthenticated ? <TravPlanPage /> : <Navigate to="/login" />}
    />
  ));
}
