import { useCallback, useEffect, useState } from "react";

import { cruiseTracksApi } from "../lib/api/cruiseTracks";
import { dawarichApi } from "../lib/api/dawarich";
import { logger } from "../lib/logger";
import type { CruiseTrackOverview } from "../types/cruiseTracks";

/** Which Dawarich pull is running: one leg's, the whole voyage's, or none. */
export type CruisePullTarget = number | "voyage" | null;

export interface CruiseTracksState {
  overview: CruiseTrackOverview | null;
  loading: boolean;
  /** The overview request failed — never shown as "no recordings". */
  loadError: boolean;
  reload: () => Promise<void>;
  uploading: boolean;
  upload: (file: File) => Promise<void>;
  pulling: CruisePullTarget;
  pullDawarich: (legOrdinal?: number) => Promise<void>;
  remove: (trackId: string) => Promise<void>;
  dawarichAvailable: boolean;
}

/**
 * A cruise's recordings and the per-leg verdicts the server gives on them.
 * Every write re-reads the overview and then calls `onChanged`, because a
 * recording changes the legs' lines and kilometres — the map and the figures
 * on the page have to be read again too.
 *
 * Mutators throw; the caller turns the failure into a message.
 */
export function useCruiseTracks(cruiseId: string, onChanged: () => void): CruiseTracksState {
  const [overview, setOverview] = useState<CruiseTrackOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pulling, setPulling] = useState<CruisePullTarget>(null);
  const [dawarichAvailable, setDawarichAvailable] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setOverview(await cruiseTracksApi.overview(cruiseId));
      setLoadError(false);
    } catch (err) {
      logger.warn("useCruiseTracks: overview failed", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [cruiseId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await dawarichApi.getSettings();
        if (!cancelled) setDawarichAvailable(settings.hasAccess);
      } catch {
        // Unknown counts as unavailable: offering a pull that can only fail
        // is worse than hiding one that might have worked.
        if (!cancelled) setDawarichAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const afterWrite = useCallback(async (): Promise<void> => {
    await reload();
    onChanged();
  }, [reload, onChanged]);

  const upload = useCallback(
    async (file: File): Promise<void> => {
      setUploading(true);
      try {
        await cruiseTracksApi.upload(cruiseId, file);
        await afterWrite();
      } finally {
        setUploading(false);
      }
    },
    [cruiseId, afterWrite]
  );

  const pullDawarich = useCallback(
    async (legOrdinal?: number): Promise<void> => {
      setPulling(legOrdinal ?? "voyage");
      try {
        await cruiseTracksApi.pullDawarich(cruiseId, legOrdinal);
        await afterWrite();
      } finally {
        setPulling(null);
      }
    },
    [cruiseId, afterWrite]
  );

  const remove = useCallback(
    async (trackId: string): Promise<void> => {
      await cruiseTracksApi.remove(cruiseId, trackId);
      await afterWrite();
    },
    [cruiseId, afterWrite]
  );

  return {
    overview,
    loading,
    loadError,
    reload,
    uploading,
    upload,
    pulling,
    pullDawarich,
    remove,
    dawarichAvailable,
  };
}
