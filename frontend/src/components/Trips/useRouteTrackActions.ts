import { useCallback } from "react";

import { dawarichFailureKey, dawarichFailureKind } from "../../lib/api/dawarich";
import { trackArchiveApi } from "../../lib/api/trackArchive";
import { downloadBlob } from "../../lib/export";
import { TRACK_ERROR_KEYS } from "../../lib/trackErrorKeys";
import type { TourTrackMeta } from "../../types/tour";
import type { useRouteEditorReports } from "./routeEditorReports";

type Reports = Pick<ReturnType<typeof useRouteEditorReports>, "clear" | "report" | "fail">;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The route editor's recording actions — upload, delete, download, Dawarich —
 * each reporting a failure in the recordings section (forgejo#246/#247).
 * Lifted out of `TripRouteEditorPage` to keep it under the 800-line limit
 * (review M9); behaviour unchanged.
 */
export function useRouteTrackActions({
  tripId: id,
  routeId,
  uploadTrack,
  deleteTrack,
  pullDawarichTrack,
  reports: { clear, report, fail },
  t,
}: {
  tripId: string | undefined;
  routeId: string | undefined;
  uploadTrack: (file: File) => Promise<unknown>;
  deleteTrack: (trackId: string) => Promise<unknown>;
  pullDawarichTrack: () => Promise<unknown>;
  reports: Reports;
  t: Translate;
}): {
  handleUploadTrack: (file: File) => void;
  handleDeleteTrack: (track: TourTrackMeta) => void;
  handleDownloadTrack: (track: TourTrackMeta) => void;
  handlePullDawarich: () => void;
} {
  const handleUploadTrack = useCallback(
    (file: File): void => {
      clear("tracks");
      void (async (): Promise<void> => {
        try {
          await uploadTrack(file);
        } catch (err) {
          // A malformed file, one without timestamps, an oversized one and a
          // duplicate each carry their own server CODE — mapped to DE/EN copy,
          // never the server's English prose.
          fail(
            "tracks",
            err,
            "trips:tours.tracks.uploadError",
            () => handleUploadTrack(file),
            TRACK_ERROR_KEYS
          );
        }
      })();
    },
    [uploadTrack, clear, fail]
  );

  const handleDeleteTrack = useCallback(
    (track: TourTrackMeta): void => {
      clear("tracks");
      void (async (): Promise<void> => {
        try {
          await deleteTrack(track.id);
        } catch (err) {
          fail("tracks", err, "trips:tours.tracks.deleteError", () => handleDeleteTrack(track));
        }
      })();
    },
    [deleteTrack, clear, fail]
  );

  const handleDownloadTrack = useCallback(
    (track: TourTrackMeta): void => {
      if (!routeId) return;
      clear("tracks");
      void (async (): Promise<void> => {
        try {
          const file = await trackArchiveApi.downloadTrack(id, routeId, track.id);
          downloadBlob(file.blob, file.filename);
        } catch (err) {
          fail("tracks", err, "roadtrips:trackArchive.downloadFailed", () =>
            handleDownloadTrack(track)
          );
        }
      })();
    },
    [id, routeId, clear, fail]
  );

  /**
   * Pulls the section's own date span from Dawarich (an empty body — the
   * server derives the window from the section's stops). Three failure
   * shapes, per `toursApi.tracks.pullDawarich`'s doc comment: a fixed-kind
   * 409 (`dawarichFailureKind` parses it, `notConfigured` included), or a
   * `code` (an empty window, too few points, no dated stops to derive one
   * from) that `TRACK_ERROR_KEYS` turns into its own DE/EN sentence.
   */
  const handlePullDawarich = useCallback((): void => {
    clear("tracks");
    void (async (): Promise<void> => {
      try {
        await pullDawarichTrack();
      } catch (err) {
        const kind = dawarichFailureKind(err);
        if (kind) report("tracks", { kind: "error", message: t(dawarichFailureKey(kind)) });
        else {
          fail(
            "tracks",
            err,
            "trips:tours.tracks.dawarich.error",
            () => handlePullDawarich(),
            TRACK_ERROR_KEYS
          );
        }
      }
    })();
  }, [pullDawarichTrack, clear, report, fail, t]);

  return { handleUploadTrack, handleDeleteTrack, handleDownloadTrack, handlePullDawarich };
}
