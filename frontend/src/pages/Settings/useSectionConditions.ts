import { useEffect } from "react";
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
  const travTrackHeld = travTrackSettingsVisible(caps);
  return {
    travTrackHeld,
    travPlanOffered,
    locationSourceHeld: travTrackHeld || dawarichSourceHeld(provider),
  };
}
