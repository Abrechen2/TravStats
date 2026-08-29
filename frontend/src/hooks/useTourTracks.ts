import { useCallback, useEffect, useRef, useState } from "react";
import { toursApi } from "../lib/api/tours";
import { dawarichApi } from "../lib/api/dawarich";
import { logger } from "../lib/logger";
import type { TourTrack, TourTrackMeta } from "../types/tour";

export interface TrackWithGeometry {
  id: string;
  geometry: ReadonlyArray<[number, number]>;
}

export interface UseTourTracksResult {
  tracks: TourTrackMeta[];
  /** Initial list fetch in flight. Mutually exclusive with `tracksLoadError`. */
  tracksLoading: boolean;
  /** The list fetch failed — distinct from `tracks.length === 0`. */
  tracksLoadError: boolean;
  loadTracks: () => Promise<void>;
  /** Each track's full geometry, resolved lazily. A track missing here only
   *  means "not fetched yet, or the fetch failed" — never "confirmed to
   *  cover nothing"; callers gating on coverage must treat it as "no
   *  candidate", not as a negative match. */
  tracksWithGeometry: TrackWithGeometry[];
  trackUploading: boolean;
  uploadTrack: (file: File) => Promise<TourTrack>;
  trackPulling: boolean;
  pullDawarichTrack: () => Promise<TourTrack>;
  deleteTrack: (trackId: string) => Promise<void>;
  /** Whether a Dawarich connection is configured and usable right now. */
  dawarichAvailable: boolean;
}

/**
 * Owns "what recorded tracks exist for this tour route section, and their
 * geometry" (phase 3b, task 8) — split out of `TripRouteEditorPage` to
 * keep that page under its file-size ceiling; this is a genuinely
 * separate concern from the page's own section/leg state, the same
 * reasoning that already split `tourLegs.ts`/`tourRouting.ts`/
 * `tourTracks.ts` apart on the backend.
 *
 * The three mutators (`uploadTrack`/`deleteTrack`/`pullDawarichTrack`)
 * REJECT on failure rather than swallowing the error — the caller decides
 * how to surface it, because each one needs a different fallback message
 * (a malformed GPX vs. a Dawarich failure kind vs. a generic delete
 * error). This hook only owns the data and the busy flags.
 */
export function useTourTracks(
  tripId: string | undefined,
  routeId: string | undefined
): UseTourTracksResult {
  const [tracks, setTracks] = useState<TourTrackMeta[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [tracksLoadError, setTracksLoadError] = useState(false);
  const [trackUploading, setTrackUploading] = useState(false);
  const [trackPulling, setTrackPulling] = useState(false);
  const [trackGeometryById, setTrackGeometryById] = useState<
    ReadonlyMap<string, ReadonlyArray<[number, number]>>
  >(new Map());
  const [dawarichAvailable, setDawarichAvailable] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadTracks = useCallback(async (): Promise<void> => {
    if (!tripId || !routeId) return;
    setTracksLoading(true);
    setTracksLoadError(false);
    try {
      const list = await toursApi.tracks.list(tripId, routeId);
      if (!mountedRef.current) return;
      setTracks(list);
    } catch (err) {
      if (!mountedRef.current) return;
      logger.warn("useTourTracks: failed to load tracks", err);
      setTracksLoadError(true);
    } finally {
      if (mountedRef.current) setTracksLoading(false);
    }
  }, [tripId, routeId]);

  useEffect(() => {
    void loadTracks();
  }, [loadTracks]);

  // Whether a Dawarich connection resolves for this user right now — a
  // mount-only fetch, the same shape `ImmichConnectionCard` uses for its
  // own settings read. A failure degrades to "unavailable" rather than
  // blocking anything: the pull button simply stays disabled.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const settings = await dawarichApi.getSettings();
        if (!cancelled) setDawarichAvailable(settings.hasAccess);
      } catch {
        if (!cancelled) setDawarichAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Full geometry per track, fetched lazily as new track ids appear. Keyed
  // off a ref (not `trackGeometryById` itself) so this effect never
  // re-fetches an id it already resolved, successfully or not — a failed
  // fetch is not retried until `tracks` reloads with that id again.
  const fetchedTrackIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tripId || !routeId) return;
    const missing = tracks.filter((tr) => !fetchedTrackIdsRef.current.has(tr.id));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      const entries = await Promise.all(
        missing.map(async (tr) => {
          fetchedTrackIdsRef.current.add(tr.id);
          try {
            const full = await toursApi.tracks.get(tripId, routeId, tr.id);
            return [tr.id, full.geometry] as const;
          } catch (err) {
            logger.warn("useTourTracks: failed to load track geometry", err);
            fetchedTrackIdsRef.current.delete(tr.id);
            return null;
          }
        })
      );
      if (cancelled || !mountedRef.current) return;
      setTrackGeometryById((prev) => {
        const next = new Map(prev);
        for (const entry of entries) {
          if (entry) next.set(entry[0], entry[1]);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tracks, tripId, routeId]);

  const tracksWithGeometry: TrackWithGeometry[] = tracks.flatMap((tr) => {
    const geometry = trackGeometryById.get(tr.id);
    return geometry ? [{ id: tr.id, geometry }] : [];
  });

  const uploadTrack = useCallback(
    async (file: File): Promise<TourTrack> => {
      if (!tripId || !routeId) throw new Error("uploadTrack called with no trip/route id");
      setTrackUploading(true);
      try {
        const track = await toursApi.tracks.upload(tripId, routeId, file);
        await loadTracks();
        return track;
      } finally {
        if (mountedRef.current) setTrackUploading(false);
      }
    },
    [tripId, routeId, loadTracks]
  );

  const deleteTrack = useCallback(
    async (trackId: string): Promise<void> => {
      if (!tripId || !routeId) return;
      await toursApi.tracks.remove(tripId, routeId, trackId);
      await loadTracks();
    },
    [tripId, routeId, loadTracks]
  );

  const pullDawarichTrack = useCallback(async (): Promise<TourTrack> => {
    if (!tripId || !routeId) throw new Error("pullDawarichTrack called with no trip/route id");
    setTrackPulling(true);
    try {
      const track = await toursApi.tracks.pullDawarich(tripId, routeId, {});
      await loadTracks();
      return track;
    } finally {
      if (mountedRef.current) setTrackPulling(false);
    }
  }, [tripId, routeId, loadTracks]);

  return {
    tracks,
    tracksLoading,
    tracksLoadError,
    loadTracks,
    tracksWithGeometry,
    trackUploading,
    uploadTrack,
    trackPulling,
    pullDawarichTrack,
    deleteTrack,
    dawarichAvailable,
  };
}
