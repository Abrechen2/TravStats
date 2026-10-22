/**
 * Why a per-account WebDAV sync did not happen — one stable code per cause,
 * so the UI says it in its own language and the user knows what to fix: a
 * wrong password is not a full share, and neither is a share that is down.
 */
export const WEBDAV_SYNC_ERROR_CODES = [
  /** Switched off, or URL/user/password missing. */
  "notConfigured",
  /** The URL is not an http(s) URL we accept (typo, credentials in it, a query). */
  "invalidUrl",
  /** The URL is http where https is required (see `targetPolicy.ts`). */
  "httpsRequired",
  /** The host is, or resolves to, an address this account may not reach. */
  "blockedTarget",
  /** The share refused the user name / password (401, 403). */
  "auth",
  /** The name does not resolve, or nothing answers at the address. */
  "unreachable",
  /** The share took longer than we wait. */
  "timeout",
  /** The share's certificate is not trusted, or TLS failed. */
  "tls",
  /** The share is full (507) or over the account's quota. */
  "quota",
  /** The share refused a file this big (413). */
  "tooLarge",
  /** The folder could not be found or created (404, 405, 409 on the path). */
  "path",
  /** The share answered with a server error (5xx). */
  "server",
  /** Anything else: answered, but not like a WebDAV share. */
  "protocol",
  /** A run of this account's sync is already in progress. */
  "alreadyRunning",
] as const;

export type WebdavSyncErrorCode = (typeof WEBDAV_SYNC_ERROR_CODES)[number];

export class WebdavSyncError extends Error {
  readonly code: WebdavSyncErrorCode;
  constructor(code: WebdavSyncErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WebdavSyncError";
    this.code = code;
  }
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
]);

function causeChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    chain.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/**
 * Map whatever the WebDAV client, fetch or the socket threw onto one code.
 * A `WebdavSyncError` keeps its own code — including one raised by the
 * address guard deep inside a connection, which fetch wraps as a cause.
 */
export function classifyWebdavError(error: unknown): WebdavSyncErrorCode {
  const chain = causeChain(error);
  for (const link of chain) {
    if (link instanceof WebdavSyncError) return link.code;
    // fetch re-wraps a socket error and keeps only its `code`: the address
    // guard's refusal arrives as a FetchError whose code is ours.
    if ((WEBDAV_SYNC_ERROR_CODES as readonly unknown[]).includes(link.code)) {
      return link.code as WebdavSyncErrorCode;
    }
  }
  for (const link of chain) {
    const status = typeof link.status === "number" ? link.status : undefined;
    if (status !== undefined) {
      if (status === 401 || status === 403) return "auth";
      if (status === 507) return "quota";
      if (status === 413) return "tooLarge";
      if (status === 404 || status === 405 || status === 409) return "path";
      if (status >= 500) return "server";
      return "protocol";
    }
  }
  for (const link of chain) {
    const name = typeof link.name === "string" ? link.name : "";
    const code = typeof link.code === "string" ? link.code : "";
    if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT") {
      return "timeout";
    }
    if (NETWORK_CODES.has(code)) return "unreachable";
    if (code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code.includes("SELF_SIGNED")) {
      return "tls";
    }
    if (
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    ) {
      return "tls";
    }
  }
  return "protocol";
}
