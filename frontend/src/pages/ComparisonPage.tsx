import "../components/comparison/comparison.css";
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import SealedWorkspace from "../components/comparison/SealedWorkspace";
export default function ComparisonPage() {
  const user = useAuthStore((s) => s.user);
  return user ? (
    <BetaFeatureRouteGuard feature="comparison" redirectTo="/dashboard">
      <SealedWorkspace />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}
