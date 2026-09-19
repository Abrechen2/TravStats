import type { EvidenceDomain, EvidenceKind, EvidenceResponse } from "../../shared/evidence";
import { api } from "./client";

/**
 * `GET /evidence/:kind/:key` — the client Task 8's panel and its `useEvidence`
 * hook call. Mirrors `backend/src/schemas/evidence.ts`'s `evidenceQuerySchema`:
 * `period` defaults server-side to `allTime` when omitted, so a caller with no
 * scope opinion (the panel, until Task 9 wires a tile) simply sends none.
 */
export interface EvidenceQueryParams {
  period?: "allTime" | "year" | "rolling12m";
  /** Required by the server when `period === "year"`, and only then. */
  year?: number;
  /** Comma-joined on the wire — the same convention `routes/countryFlags.ts` uses for `codes`. */
  domains?: EvidenceDomain[];
  offset?: number;
  limit?: number;
}

export const evidenceApi = {
  /**
   * `key` travels through `encodeURIComponent`: a ranking key such as
   * `airline:LH` carries a colon that must survive the trip through the URL,
   * and Express hands the path param back decoded on the other side.
   */
  get: async (
    kind: EvidenceKind,
    key: string,
    params?: EvidenceQueryParams
  ): Promise<EvidenceResponse> => {
    const { domains, ...rest } = params ?? {};
    const { data } = await api.get<EvidenceResponse>(
      `/evidence/${kind}/${encodeURIComponent(key)}`,
      { params: { ...rest, domains: domains?.length ? domains.join(",") : undefined } }
    );
    return data;
  },
};
