import { useEffect, useState } from "react";

import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import type { RemoteSharingStatus } from "../../types/sharingRemote";

/** Why a trip cannot be shared with someone on another server here; `null` when it can. */
export type RemoteShareBlock = "noAddress" | "switchOff" | "noPeer" | "loadFailed";

/**
 * The missing setup step, in the order an admin fixes them (Admin → Instanz checklist, owner
 * 2026-10-26). `beta-off` names nothing: the beta key hides the feature from this screen too.
 */
export function remoteShareBlock(status: RemoteSharingStatus): RemoteShareBlock | null {
  if (status.reason === "no-identity") return "noAddress";
  if (status.reason === "switch-off") return "switchOff";
  if (!status.available) return null;
  return status.peerAdmitted ? null : "noPeer";
}

/**
 * Asked once the "Teilen" menu opens and only behind the `federatedTripSharing` beta key, so a
 * closed menu or a closed key costs no request. Tagged with its trip like the menu's own state.
 */
export function useRemoteShareBlock(tripId: string, open: boolean): RemoteShareBlock | null {
  const { isFeatureVisible } = useBetaFeatures();
  const visible = isFeatureVisible("federatedTripSharing");
  const [block, setBlock] = useState<{ tripId: string; value: RemoteShareBlock | null } | null>(
    null
  );
  const known = block?.tripId === tripId;

  useEffect(() => {
    if (!visible || !open || known) return;
    let cancelled = false;
    sharingRemoteApi.status().then(
      (status) => {
        if (!cancelled) setBlock({ tripId, value: remoteShareBlock(status) });
      },
      (error: unknown) => {
        logger.error("Loading whether trips can be shared with other servers failed:", error);
        if (!cancelled) setBlock({ tripId, value: "loadFailed" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [visible, open, known, tripId]);

  return visible && known ? block.value : null;
}
