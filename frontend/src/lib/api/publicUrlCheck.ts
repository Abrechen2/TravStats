import { api } from "./client";

/** `POST /admin/public-url/check` (readiness stage 2, §12). */
export type PublicUrlCheckErrorCode =
  | "NO_PUBLIC_URL"
  | "OUTBOUND_DISABLED"
  | "TIMEOUT"
  | "DNS"
  | "TLS"
  | "CONNECTION"
  | "HTTP_STATUS"
  | "NOT_THIS_INSTANCE";

export interface PublicUrlCheckResult {
  ok: boolean;
  checkedAt: string;
  url: string | null;
  httpStatus: number | null;
  errorCode: PublicUrlCheckErrorCode | null;
}

/** The server probes for up to 10 s; the default client timeout is 10 s, so give it room. */
const PUBLIC_URL_CHECK_TIMEOUT_MS = 20_000;

export const publicUrlCheckApi = {
  /** Asks the server to reach its own public address from outside. */
  checkPublicUrl: async (): Promise<PublicUrlCheckResult> => {
    const { data } = await api.post<PublicUrlCheckResult>(
      "/admin/public-url/check",
      {},
      { timeout: PUBLIC_URL_CHECK_TIMEOUT_MS }
    );
    return data;
  },
};
