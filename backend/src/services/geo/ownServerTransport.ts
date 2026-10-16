import { ownGeoUrl } from "./ownServerConfig";

export class OwnGeoUnavailable extends Error {
  constructor(
    public readonly code: "disabled" | "unavailable" | "invalid_response" | "busy" | "timeout",
    /** Operator-facing cause for the log: an upstream status or error message, never a path. */
    public readonly detail?: string
  ) {
    super(code);
    this.name = "OwnGeoUnavailable";
  }
}

/**
 * Upstream requests in flight across the whole process. A map view fires a
 * burst of tile requests; each may buffer up to 8 MB, so the cap bounds both
 * the load on the operator's map server and our own memory (24 x 8 MB). Past
 * it a request is refused at once as `busy`, and the route answers 503 with
 * Retry-After so MapLibre retries the tile instead of keeping a hole.
 */
export const MAX_PENDING_UPSTREAM = 24;
let pending = 0;
/** No redirect, cookies, user headers, third-party fallback or coordinate logging. */
export async function ownGeoRequest(
  path: string,
  options: { body?: unknown; maxBytes?: number; timeoutMs?: number } = {}
): Promise<{ body: Buffer; contentType: string; status: number }> {
  const origin = ownGeoUrl();
  if (!origin) throw new OwnGeoUnavailable("disabled");
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n#]/.test(path)) {
    throw new OwnGeoUnavailable("invalid_response");
  }
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new OwnGeoUnavailable("invalid_response");
  if (pending >= MAX_PENDING_UPSTREAM) throw new OwnGeoUnavailable("busy");
  pending++;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Accept: "*/*",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: controller.signal,
    });
    if (![200, 204, 404].includes(response.status))
      throw new OwnGeoUnavailable("unavailable", `upstream status ${response.status}`);
    const max = options.maxBytes ?? 8 * 1024 * 1024;
    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > max) throw new OwnGeoUnavailable("invalid_response");
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > max) throw new OwnGeoUnavailable("invalid_response");
        chunks.push(part.value);
      }
    }
    return {
      body: Buffer.concat(chunks),
      status: response.status,
      contentType:
        response.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof OwnGeoUnavailable) throw error;
    if (timedOut) throw new OwnGeoUnavailable("timeout");
    throw new OwnGeoUnavailable(
      "unavailable",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    clearTimeout(timer);
    pending--;
  }
}
