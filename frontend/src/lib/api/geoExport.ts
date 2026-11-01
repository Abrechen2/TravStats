import { api } from "./client";
import type { DownloadedFile } from "./trackArchive";

/**
 * GPX / KML downloads (forgejo#402), `backend/src/routes/geoExport.ts`. The
 * server names the file; `path` is the route below `/api/v1`.
 */

export type GeoFormat = "gpx" | "kml";

/** The server refused with 422 GEO_EXPORT_EMPTY: the record has no line (or the account no place). */
export class GeoExportEmptyError extends Error {
  constructor() {
    super("geo_export_empty");
    this.name = "GeoExportEmptyError";
  }
}

export const geoExportPaths = {
  flight: (id: string) => `/flights/${id}/track/export`,
  cruise: (id: string) => `/cruises/${id}/tracks/export`,
  rail: (id: string) => `/rail/${id}/line/export`,
  bus: (id: string) => `/bus/${id}/line/export`,
  ferry: (id: string) => `/ferry/${id}/line/export`,
  places: "/places/export",
} as const;

function filenameFrom(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export async function downloadGeoFile(
  path: string,
  format: GeoFormat,
  params: Record<string, string> = {}
): Promise<DownloadedFile> {
  try {
    const res = await api.get<Blob>(path, {
      responseType: "blob",
      params: { ...params, format },
    });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], `export.${format}`),
    };
  } catch (err) {
    // A blob body hides the JSON error code; the status alone says "nothing to write".
    if ((err as { response?: { status?: number } }).response?.status === 422) {
      throw new GeoExportEmptyError();
    }
    throw err;
  }
}
