import { lazy } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import FriendsPage from "../components/friends/FriendsPage";

// Lazy again, so the device-encrypted transfer stays out of the friends page's chunk.
const EncryptedSharePage = lazy(() => import("./EncryptedSharePage"));

/**
 * App.tsx routes both `/freunde` and `/encrypted-share` here (it stands at the 800-line limit),
 * and the path picks the page: the friends page behind `comparison`, or the encrypted share,
 * which carries its own guard behind `encryptedShare`.
 */
export default function ComparisonPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  if (pathname.startsWith("/encrypted-share")) return <EncryptedSharePage />;
  return user ? (
    <BetaFeatureRouteGuard feature="comparison" redirectTo="/dashboard">
      <FriendsPage />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}
