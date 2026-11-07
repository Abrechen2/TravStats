import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";

const FriendInvitePage = lazy(() => import("./FriendInvitePage"));
const FriendAcceptPage = lazy(() => import("./FriendAcceptPage"));

/**
 * The friends routes that are not the page itself (`/freunde` goes through ComparisonPage, with
 * the encrypted share): the old `/compare` bookmark, the public invitation landing page, and
 * the signed-in accept page. As in planRoutes, plain `<Route>` elements for App's `<Routes>`.
 *
 * The landing page needs no session and no beta flag (spec 2026-11-07 §9.5): it reads the URL
 * fragment and sends nothing. The accept page runs on the reader's OWN server, so it follows
 * that instance's `comparison` key.
 */
export function friendsRoutes(isAuthenticated: boolean): JSX.Element[] {
  return [
    <Route key="compare" path="/compare" element={<Navigate to="/freunde" replace />} />,
    <Route key="invite" path="/freunde/einladung" element={<FriendInvitePage />} />,
    <Route
      key="accept"
      path="/freunde/annehmen"
      element={
        isAuthenticated ? (
          <BetaFeatureRouteGuard feature="comparison" redirectTo="/dashboard">
            <FriendAcceptPage />
          </BetaFeatureRouteGuard>
        ) : (
          <Navigate to="/login" />
        )
      }
    />,
  ];
}
