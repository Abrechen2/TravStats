import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const TravPlanPage = lazy(() => import("./TravPlanRoute"));
const GuestJoinPage = lazy(() => import("./TravPlanGuest/GuestJoinPage"));
const GuestCallbackPage = lazy(() => import("./TravPlanGuest/GuestCallbackPage"));
const GuestPlanPage = lazy(() => import("./TravPlanGuest/GuestPlanPage"));
const VouchPage = lazy(() => import("./TravPlanGuest/VouchPage"));

/**
 * The three `/plan*` routes, as plain `<Route>` elements for App's `<Routes>` (React Router
 * accepts an array there; it would not accept a component wrapping them). Moved out of App.tsx,
 * which stands at the 800-line limit, to make room for the `/encrypted-share` path on
 * 2026-10-16.
 */
export function planRoutes(isAuthenticated: boolean): JSX.Element[] {
  const own = ["/plan", "/plan/admin", "/plan/:tripId/:section?"].map((path) => (
    <Route
      key={path}
      path={path}
      element={isAuthenticated ? <TravPlanPage /> : <Navigate to="/login" />}
    />
  ));
  // Remote guests (forgejo#404, spec 2026-10-17 §6.5): they hold no account here, so these are
  // open routes. `/plan/join*` are static and win over `/plan/:tripId`; each page asks the
  // server for what it needs and the server decides. The vouch page is the guest's OWN server's.
  return [
    ...own,
    <Route key="guest-join" path="/plan/join" element={<GuestJoinPage />} />,
    <Route key="guest-callback" path="/plan/join/callback" element={<GuestCallbackPage />} />,
    <Route key="guest-plan" path="/guest/plan/:tripId/:section?" element={<GuestPlanPage />} />,
    <Route key="guest-vouch" path="/federation/vouch" element={<VouchPage />} />,
  ];
}
