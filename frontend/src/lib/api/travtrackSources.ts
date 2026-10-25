import { api } from "./client";
import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "../apiError";

/**
 * Further TravTrack sources (TravTrack plan E9): OwnTracks and Overland post
 * positions with a per-device ingest token. A token is shown once, when it is
 * created; the list never carries it.
 */

export type IngestTokenKind = "owntracks" | "overland";

export interface IngestToken {
  id: string;
  kind: IngestTokenKind;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedIngestToken extends IngestToken {
  /** `tt_ingest_…` — shown once. */
  token: string;
  /** Where the app posts. */
  url: string;
}

export const travTrackSourcesApi = {
  list: async (): Promise<IngestToken[]> =>
    (await api.get<{ tokens: IngestToken[] }>("/travtrack/ingest-tokens")).data.tokens,
  create: async (input: { kind: IngestTokenKind; label: string }): Promise<CreatedIngestToken> =>
    (await api.post<CreatedIngestToken>("/travtrack/ingest-tokens", input)).data,
  revoke: async (id: string): Promise<void> => {
    await api.delete(`/travtrack/ingest-tokens/${encodeURIComponent(id)}`);
  },
};

/** The `track:` key for a failed token call — by the server's code, never its prose. */
export function sourcesErrorKey(err: unknown): string {
  const response = (err as { response?: { status?: number } } | null)?.response;
  if (response?.status === 429) return "track:sources.errors.rateLimited";
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "common:saveErrors.demo";
  switch (apiErrorMachineCode(err)) {
    case "TRAVTRACK_NOT_ACTIVE":
      return "track:sources.errors.notActive";
    case "INGEST_TOKEN_LIMIT":
      return "track:sources.errors.limit";
    case "INGEST_TOKEN_NOT_FOUND":
      return "track:sources.errors.notFound";
    case "TRAVTRACK_DISABLED":
      return "track:errors.disabled";
    default:
      return response ? "track:errors.generic" : "track:errors.network";
  }
}
