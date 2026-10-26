import type {
  DataQualityFlag,
  FindingAction,
  DataQualityFlagKind,
  DataQualityFlagStatus,
  DataQualityRunSummary,
} from "../../types/dataQuality";

import { api } from "./client";

/**
 * The data-quality inbox (`/api/v1/data-quality-flags`).
 *
 * A sibling of `pendingUpdates.ts`, and deliberately shaped like it: the user
 * sees ONE Posteingang, but a proposed field diff for a flight and a question
 * about a record are two different things and stay two different tables.
 *
 * `resolve` and `dismiss` are two endpoints because they are two answers, not
 * two spellings of "done" — see `types/dataQuality.ts`.
 */
/** Every answer replies with the finding as it now stands; null once its record is gone. */
export interface FindingAnswer {
  success: boolean;
  data?: DataQualityFlag | null;
}

export const dataQualityFlagsApi = {
  /** `status` defaults to `open` server-side, because an inbox is open questions. */
  getAll: async (filters?: {
    status?: DataQualityFlagStatus | "all";
    kind?: DataQualityFlagKind;
  }): Promise<{ flags: DataQualityFlag[]; count: number }> => {
    const { data } = await api.get<{ flags: DataQualityFlag[]; count: number }>(
      "/data-quality-flags",
      { params: filters }
    );
    return data;
  },

  /**
   * "I have corrected the data." A re-run re-opens this if it did not stick.
   * With an `action` (one of the flag's `actions`), a kind-specific answer.
   */
  resolve: async (
    id: string,
    answer?: { action: FindingAction; keptId?: string; revision?: number }
  ): Promise<FindingAnswer> => {
    const { data } = answer
      ? await api.post<FindingAnswer>(`/data-quality-flags/${id}/resolve`, answer)
      : await api.post<FindingAnswer>(`/data-quality-flags/${id}/resolve`);
    return data;
  },

  /** "This is not wrong, stop asking." Never re-opened. */
  dismiss: async (id: string): Promise<FindingAnswer> => {
    const { data } = await api.post<FindingAnswer>(`/data-quality-flags/${id}/dismiss`);
    return data;
  },

  /** Take the last answer back while `undoUntil` lies ahead (spec C3). */
  undo: async (id: string): Promise<FindingAnswer> => {
    const { data } = await api.post<FindingAnswer>(`/data-quality-flags/${id}/undo`);
    return data;
  },

  /** Re-run every check for the calling account. Rate-limited on the stats bucket. */
  run: async (): Promise<DataQualityRunSummary> => {
    const { data } = await api.post<DataQualityRunSummary>("/data-quality-flags/run");
    return data;
  },
};
