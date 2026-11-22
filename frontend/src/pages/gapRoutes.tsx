import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const GapsPage = lazy(() => import("./GapsPage"));

/** `/gaps`, as a plain `<Route>` for App's `<Routes>` (App.tsx stands near the 800-line limit). */
export function gapRoutes(isAuthenticated: boolean): JSX.Element {
  return <Route path="/gaps" element={isAuthenticated ? <GapsPage /> : <Navigate to="/login" />} />;
}
