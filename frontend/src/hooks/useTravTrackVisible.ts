import { useEffect, useState } from "react";
import { useBetaFeatures } from "./useBetaFeatures";
import { useAuthStore } from "../store/authStore";
import { travTrackApi, type TravTrackCapabilities } from "../lib/api/travtrack";
import { logger } from "../lib/logger";

/**
 * What `/travtrack/capabilities` says for this account, or null while it is
 * pending, after it failed, or while `ask` is false (nothing is requested
 * then — the navigation does not ask while the beta key is closed). Every
 * TravTrack surface of the web reads it through here.
 */
export function useTravTrackCapabilities(ask = true): TravTrackCapabilities | null {
  return useCapabilitiesRead(ask).caps;
}

/** The read and whether it has settled — answered or failed. */
function useCapabilitiesRead(ask: boolean): {
  caps: TravTrackCapabilities | null;
  settled: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const [read, setRead] = useState<{ caps: TravTrackCapabilities | null; settled: boolean }>({
    caps: null,
    settled: false,
  });

  useEffect(() => {
    setRead({ caps: null, settled: false });
    if (!userId || !ask) return;
    let live = true;
    travTrackApi
      .capabilities()
      .then((answer) => {
        if (live) setRead({ caps: answer, settled: true });
      })
      .catch((cause: unknown) => {
        logger.warn("Failed to load TravTrack capabilities", cause);
        if (live) setRead({ caps: null, settled: true });
      });
    return () => {
      live = false;
    };
  }, [userId, ask]);

  return read;
}

export type TravTrackAccess = "pending" | "visible" | "hidden";

/**
 * Whether `/track` and its menu entry are offered (TravTrack plan T6) — the
 * one home of the rule: the `travTrack` beta key, the instance showing
 * TravTrack (`enabled`), and this account either recording into it (`active`)
 * or holding data. Fails closed: pending or failed reads as not offered.
 *
 * TravTrack switched off hides the page even for an account holding data;
 * Settings keeps that account's summary, export and delete (`TravTrackSection`).
 */
export function useTravTrackAccess(): TravTrackAccess {
  const { isFeatureVisible } = useBetaFeatures();
  const keyOpen = isFeatureVisible("travTrack");
  const { caps, settled } = useCapabilitiesRead(keyOpen);
  if (!keyOpen) return "hidden";
  if (!settled) return "pending";
  if (!caps) return "hidden";
  return caps.enabled && (caps.active || caps.hasData) ? "visible" : "hidden";
}

export function useTravTrackVisible(): boolean {
  return useTravTrackAccess() === "visible";
}

/**
 * Whether TravTrack is on on this server — the beta key and the instance
 * (`enabled`), whatever this account does with it. What a reader needs to see
 * a route another member shares (`GET /trips/:id/shared-route`, the server's
 * `on` tier): a recipient who never recorded anything still reads it. Fails
 * closed while pending or after a failed read.
 */
export function useTravTrackInstanceOn(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const keyOpen = isFeatureVisible("travTrack");
  const { caps } = useCapabilitiesRead(keyOpen);
  return keyOpen && caps !== null && caps.enabled;
}

/**
 * Whether Settings shows the TravTrack section: whenever the account holds
 * data (so it can still read, export and delete it with TravTrack off —
 * review focus 14) or the instance shows TravTrack. Not behind the beta key:
 * data held is data the owner must be able to reach.
 */
export function travTrackSettingsVisible(caps: TravTrackCapabilities | null): boolean {
  return caps !== null && (caps.hasData || caps.enabled);
}
