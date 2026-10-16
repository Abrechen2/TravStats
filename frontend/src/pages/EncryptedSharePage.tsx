import "../components/encryptedShare/encryptedShare.css";
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import SealedWorkspace from "../components/encryptedShare/SealedWorkspace";

/** The device-encrypted full-record transfer, behind its own key since 2026-10-16. */
export default function EncryptedSharePage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  return user ? (
    <BetaFeatureRouteGuard feature="encryptedShare" redirectTo="/compare">
      <SealedWorkspace />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}
