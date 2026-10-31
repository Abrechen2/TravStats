import { useEffect } from "react";
import { routesBlockedReason } from "../lib/mapRoutes";
import { useMapRoutesStore } from "../store/mapRoutesStore";
import { useDashboardRoute } from "./useDashboardRoute";

/**
 * Tells the route-switch store whether the open dashboard mode is one that is
 * nothing but routes. Mounted once by the dashboard page, so the maps and
 * legends — which are not in the panel — agree with the panel's disabled switch.
 */
export function usePublishRoutesBlocked(): void {
  const { tab, mode } = useDashboardRoute();
  const setBlocked = useMapRoutesStore((s) => s.setBlocked);
  const blocked = routesBlockedReason(tab, mode) !== null;
  useEffect(() => {
    setBlocked(blocked);
    return () => setBlocked(false);
  }, [blocked, setBlocked]);
}
