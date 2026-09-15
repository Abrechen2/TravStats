import http from "http";
import https from "https";

/**
 * One HTTP text request with a HARD deadline.
 *
 * The lodging parsers talk to Ollama, which the owner runs on weak hardware
 * and which has timed out in production — so no parse may depend on it, and
 * every call must come back inside its budget whatever the server does.
 *
 * Three things `http.request` plus `req.setTimeout()` does NOT give you, and
 * which this helper does (AUD-058, measured on the booking parser):
 *
 * - `setTimeout` is an INACTIVITY timer: it resets on every byte, so a server
 *   trickling a space every 25 ms sailed past an 80 ms budget and answered
 *   after 412 ms. The deadline here is wall-clock from the request start.
 * - A response that stops mid-body never fires `end`. `req.on("error")` does
 *   not see it either, so the promise was simply never settled and the
 *   caller's manual fallback was never reached. Every way a response can
 *   stop — `error`, `aborted`, `close` before `end` — settles here.
 * - The body is capped, and the status code is checked, rather than leaving
 *   both to the JSON-shape check downstream to catch by coincidence.
 *
 * `mappingSuggestion.ts` grew this shape first; the booking parser now uses
 * the same one instead of a copy that lacked two thirds of it.
 */
export interface BoundedRequestOptions {
  url: string;
  method: "GET" | "POST";
  body?: string;
  /** Wall-clock budget for the whole exchange, connect to last byte. */
  timeoutMs: number;
  maxResponseBytes: number;
  /** Names the caller in error messages ("Ollama request", "Mapping suggestion"). */
  label: string;
}

export function requestTextWithDeadline(options: BoundedRequestOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn();
    };
    const fail = (err: Error): void => settle(() => reject(err));

    const headers: http.OutgoingHttpHeaders =
      options.body === undefined
        ? {}
        : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body) };

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: options.method,
        headers,
      },
      (res) => {
        let data = "";
        let receivedBytes = 0;
        let ended = false;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (settled) return;
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > options.maxResponseBytes) {
            fail(new Error(`${options.label} response exceeded ${options.maxResponseBytes} bytes`));
            req.destroy();
            return;
          }
          data += chunk;
        });
        res.on("end", () => {
          ended = true;
          if (settled) return;
          const statusCode = res.statusCode ?? 0;
          if (statusCode !== 200) {
            fail(new Error(`Ollama returned HTTP ${statusCode}`));
            return;
          }
          settle(() => resolve(data));
        });
        res.on("error", fail);
        res.on("aborted", () => fail(new Error(`${options.label} response was aborted`)));
        // `close` follows `end` on a complete response and is then a no-op
        // (already settled). Without a preceding `end` it is the one signal a
        // truncated body leaves behind.
        res.on("close", () => {
          if (!ended) fail(new Error(`${options.label} connection closed before the response ended`));
        });
      },
    );

    deadline = setTimeout(() => {
      fail(new Error(`${options.label} timeout after ${options.timeoutMs}ms`));
      req.destroy();
    }, options.timeoutMs);

    req.on("error", fail);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
