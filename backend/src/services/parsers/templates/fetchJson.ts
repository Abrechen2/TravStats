import http from "http";
import https from "https";
import { isLocalLlmHost } from "../../llm/llmEndpoint";

/**
 * The largest body read, in bytes. The repository's documents are small: the
 * bundled snapshot's index is 4 KB for 29 templates and its largest template
 * 14 KB (`v2/snapshot/`, measured 2026-10-21). 2 MiB leaves ~140x headroom
 * for a template and room for an index of thousands, while bounding what a
 * broken or hostile repository — an admin may name any host — can make the
 * server hold in memory.
 */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Inactivity limit: no byte for this long ends the request. */
const IDLE_TIMEOUT_MS = 10_000;
/**
 * Whole-request limit. The idle timeout alone never trips on a body that
 * trickles a byte at a time; 30 s is three idle windows, ample for 2 MiB.
 */
const DEADLINE_MS = 30_000;

export type FetchJsonFailure = "too_large" | "timeout";

/** A failure the caller may word for a user; anything else is a plain Error. */
export class FetchJsonError extends Error {
  constructor(
    readonly reason: FetchJsonFailure,
    message: string
  ) {
    super(message);
    this.name = "FetchJsonError";
  }
}

export interface FetchJsonOptions {
  /** For tests: a shorter whole-request limit. */
  deadlineMs?: number;
}

/**
 * GET a JSON document over https — or plain http to a local/LAN host only,
 * for an admin's self-hosted mirror (forgejo#309; `v2/source.ts`) — rejecting
 * on any non-200, a timeout, a body over `MAX_RESPONSE_BYTES` or one that is
 * not JSON. Shared by the v1 airline sync, the v2 loader and the admin's
 * repository test.
 */
export function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Not a URL"));
      return;
    }
    const plain = parsed.protocol === "http:";
    if (!plain && parsed.protocol !== "https:") {
      reject(new Error(`Unsupported protocol ${parsed.protocol}`));
      return;
    }
    if (plain && !isLocalLlmHost(parsed.hostname)) {
      reject(new Error(`Plain http is allowed to a local host only, not ${parsed.host}`));
      return;
    }
    const req = (plain ? http : https).get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"} from ${url}`));
        res.resume(); // drain the response
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          req.destroy(
            new FetchJsonError(
              "too_large",
              `Response from ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`
            )
          );
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown);
        } catch (e) {
          reject(e);
        }
      });
    });
    const deadline = setTimeout(() => {
      req.destroy(new FetchJsonError("timeout", `Deadline exceeded fetching ${url}`));
    }, options.deadlineMs ?? DEADLINE_MS);
    req.on("close", () => clearTimeout(deadline));
    req.setTimeout(IDLE_TIMEOUT_MS, () => {
      req.destroy(new FetchJsonError("timeout", `Timeout fetching ${url}`));
    });
    req.on("error", reject);
  });
}
