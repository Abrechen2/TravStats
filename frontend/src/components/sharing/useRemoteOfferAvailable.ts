import { useEffect, useState } from "react";

import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";

/**
 * Whether this trip can be offered to people on other servers from here: the
 * `federatedTripSharing` beta key is on, the server has federation switched
 * on, and the trip is not one that came from another server (its home adds
 * people, not this copy). The same three conditions that decide whether
 * `RemoteTripPeople` draws its offer controls, asked once so the head's menu
 * can leave the entry out instead of opening an empty dialog.
 *
 * A failed lookup answers `true`: the dialog then says the load failed, which
 * is better than an entry that silently is not there.
 */
export function useRemoteOfferAvailable(tripId: string): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const visible = isFeatureVisible("federatedTripSharing");
  const [answer, setAnswer] = useState<{ tripId: string; value: boolean } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await sharingRemoteApi.status();
        const value = status.available
          ? (await sharingRemoteApi.tripSharing(tripId)).homeOrigin === null
          : false;
        if (!cancelled) setAnswer({ tripId, value });
      } catch (error) {
        logger.error("Failed to check whether the trip can be offered to other servers:", error);
        if (!cancelled) setAnswer({ tripId, value: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, visible]);

  return visible && answer?.tripId === tripId && answer.value;
}
