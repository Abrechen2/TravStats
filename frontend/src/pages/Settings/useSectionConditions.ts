import { useEffect } from "react";
import { useAuthStore } from "../../store/authStore";
import { useFederationStatus } from "../../store/federationStatusStore";
import {
  travTrackSettingsVisible,
  useTravTrackCapabilities,
} from "../../hooks/useTravTrackVisible";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTravPlanInstanceOn } from "../../hooks/useTravPlanVisible";
import { useLocationProviderStore } from "../../store/locationProviderStore";
import type { LocationProviderSettings } from "../../lib/api/locationProvider";
import type { SectionCondition } from "./surface";

/**
 * Whether an account has a location source the TravTrack area must keep
 * reachable without TravTrack: it chose Dawarich, or it has an own Dawarich
 * connection to choose it with (coordinator call, settings v3 S1/S4). Without
 * this a Dawarich-only account on a server that does not offer TravTrack would
 * lose the source choice and the stay search, the only place they live.
 * Unknown (not loaded, or the read failed) is not held.
 */
export function dawarichSourceHeld(settings: LocationProviderSettings | null): boolean {
  return settings !== null && (settings.kind === "dawarich" || settings.choices?.dawarich === true);
}

/**
 * The server-decided section conditions (`SectionDef.when`), for the settings
 * page and its search alike — so a section the page does not draw is not
 * offered as a search hit either.
 */
export function useSectionConditions(): Partial<Record<SectionCondition, boolean>> {
  const caps = useTravTrackCapabilities();
  const travPlanOffered = useTravPlanInstanceOn();
  const isDemo = useIsDemoAccount();
  const provider = useLocationProviderStore((s) => s.settings);
  const refresh = useLocationProviderStore((s) => s.refresh);
  useEffect(() => {
    if (!isDemo) void refresh();
  }, [isDemo, refresh]);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const federation = useFederationStatus((s) => s.enabled);
  const refreshFederation = useFederationStatus((s) => s.refresh);
  // The page "Server-Verbindungen" exists only while the admin has the server connect to others.
  useEffect(() => {
    if (isAdmin && !isDemo) void refreshFederation();
  }, [isAdmin, isDemo, refreshFederation]);
  const travTrackHeld = travTrackSettingsVisible(caps);
  return {
    federationOn: isAdmin && federation === true,
    travTrackHeld,
    travPlanOffered,
    locationSourceHeld: travTrackHeld || dawarichSourceHeld(provider),
  };
}
