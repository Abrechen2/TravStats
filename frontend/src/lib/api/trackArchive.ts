import { api } from "./client";

/**
 * Recordings as files (2.7): one GPX per recording, every recording as a ZIP,
 * and GPX/TCX/FIT files or ZIPs of them read back in. The server side is
 * `backend/src/routes/trips/tourTrackArchive.ts`; the placement rules are in
 * `services/tour/tracks/trackArchiveImport.ts`.
 */

export type TrackArchiveAction = "attach" | "createTour" | "duplicate" | "error";

export interface TrackArchiveFileOutcome {
  file: string;
  action: TrackArchiveAction;
  tourId: string | null;
  tourName: string | null;
  message?: "unreadable" | "noTimestamps" | "roadtripNotFound" | "ambiguousTour";
}

export interface TrackArchiveImportResult {
  dryRun: boolean;
  files: TrackArchiveFileOutcome[];
}

/** An import the server refused as a whole — the ZIP is past its limits. */
export class TrackArchiveTooLarge extends Error {
  constructor() {
    super("archive_too_large");
    this.name = "TrackArchiveTooLarge";
  }
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** The server names the file; the fallback only covers a proxy that strips the header. */
function filenameFrom(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

function trackPath(tripId: string | undefined, routeId: string, trackId: string): string {
  const section = tripId === undefined ? `/tours/${routeId}` : `/trips/${tripId}/routes/${routeId}`;
  return `${section}/tracks/${trackId}/gpx`;
}

export const trackArchiveApi = {
  downloadTrack: async (
    tripId: string | undefined,
    routeId: string,
    trackId: string
  ): Promise<DownloadedFile> => {
    const res = await api.get<Blob>(trackPath(tripId, routeId, trackId), {
      responseType: "blob",
    });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], "track.gpx"),
    };
  },

  downloadAll: async (): Promise<DownloadedFile> => {
    const res = await api.get<Blob>("/track-archive", { responseType: "blob" });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], "travstats-recordings.zip"),
    };
  },

  /** `dryRun` true reports what would happen and writes nothing. */
  importFiles: async (
    files: readonly File[],
    dryRun: boolean
  ): Promise<TrackArchiveImportResult> => {
    const form = new FormData();
    form.append("dryRun", String(dryRun));
    for (const file of files) form.append("files", file);
    try {
      const { data } = await api.post<TrackArchiveImportResult>("/track-archive/import", form, {
        headers: { "Content-Type": "multipart/form-data" },
        // A ZIP of a year of hikes takes longer than a JSON call.
        timeout: 5 * 60 * 1000,
      });
      return data;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 413) throw new TrackArchiveTooLarge();
      throw err;
    }
  },
};
