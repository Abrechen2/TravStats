import { api } from "./client";
import { waitForJob, type JobView } from "./jobs";

/**
 * The account archive (forgejo#433): one account as a ZIP with every record and
 * every file, to move it to another TravStats server, and the import into an
 * empty account. Server side: `backend/src/routes/accountArchive.ts`.
 */

export interface AccountArchiveStatus {
  /** The account holds no records yet, so it can take an import. */
  empty: boolean;
  /** An export or import of this account is running. */
  busy: boolean;
  maxBytes: number;
}

export interface AccountArchiveExport {
  exportId: string;
  filename: string;
  bytes: number;
  files: number;
  missingFiles: number;
  tables: Record<string, number>;
}

export interface AccountArchiveImport {
  archiveId: string;
  files: number;
  tables: Record<string, number>;
  alreadyImported: boolean;
  /** Rows refused per table: their file, parent or catalogue row was missing. */
  skipped: Record<string, number>;
  /** Catalogue references (port, airport, station, ...) with no match on this server. */
  unmatched: number;
  /** Files whose bytes this server would not accept as an upload. */
  refusedFiles: number;
}

type OnPoll = (job: JobView<unknown>) => void;

export const accountArchiveApi = {
  status: async (): Promise<AccountArchiveStatus> => {
    const { data } = await api.get<{ success: boolean; data: AccountArchiveStatus }>(
      "/me/account-archive"
    );
    return data.data;
  },

  /** Starts the export and waits for it; throws `JobFailedError` with the server's code. */
  exportArchive: async (onPoll?: OnPoll): Promise<AccountArchiveExport> => {
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>(
      "/me/account-archive/export"
    );
    return waitForJob<AccountArchiveExport>(data.data.jobId, {
      onPoll: onPoll as ((job: JobView<AccountArchiveExport>) => void) | undefined,
    });
  },

  download: async (exportId: string): Promise<Blob> => {
    const res = await api.get<Blob>(`/me/account-archive/export/${exportId}`, {
      responseType: "blob",
      // An archive with every photo takes longer than the client's default.
      timeout: 0,
    });
    return res.data;
  },

  importArchive: async (file: File, onPoll?: OnPoll): Promise<AccountArchiveImport> => {
    const form = new FormData();
    form.append("archive", file);
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>(
      "/me/account-archive/import",
      form,
      // The shared client sends JSON by default; a multipart body must say so.
      { headers: { "Content-Type": "multipart/form-data" }, timeout: 0 }
    );
    return waitForJob<AccountArchiveImport>(data.data.jobId, {
      onPoll: onPoll as ((job: JobView<AccountArchiveImport>) => void) | undefined,
    });
  },
};
