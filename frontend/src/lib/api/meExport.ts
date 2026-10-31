import axios from "axios";
import { api } from "./client";

/**
 * The signed-in account's own data as one JSON file (forgejo#391). The server
 * side is `backend/src/routes/meExport.ts`.
 */

export type MeExportFailure = "rateLimited" | "unauthorized" | "network" | "server";

export class MeExportError extends Error {
  constructor(readonly reason: MeExportFailure) {
    super(`me_export_${reason}`);
    this.name = "MeExportError";
  }
}

function filenameFrom(disposition: unknown): string {
  const match =
    typeof disposition === "string" ? /filename\*=UTF-8''([^;]+)/i.exec(disposition) : null;
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      // fall through to the dated default
    }
  }
  return `travstats-my-data-${new Date().toISOString().slice(0, 10)}.json`;
}

function reasonOf(err: unknown): MeExportFailure {
  if (!axios.isAxiosError(err)) return "server";
  if (!err.response) return "network";
  if (err.response.status === 429) return "rateLimited";
  if (err.response.status === 401 || err.response.status === 403) return "unauthorized";
  return "server";
}

export const meExportApi = {
  download: async (): Promise<{ blob: Blob; filename: string }> => {
    try {
      const res = await api.get<Blob>("/me/export", {
        responseType: "blob",
        // A long history takes longer than the client's default.
        timeout: 0,
      });
      return { blob: res.data, filename: filenameFrom(res.headers["content-disposition"]) };
    } catch (err) {
      throw new MeExportError(reasonOf(err));
    }
  },
};
