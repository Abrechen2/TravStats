import http from "http";
import https from "https";
import { isLocalLlmHost } from "../../llm/llmEndpoint";

/**
 * GET a JSON document over https — or plain http to a local/LAN host only,
 * for an admin's self-hosted mirror (forgejo#309; `v2/source.ts`) — rejecting
 * on any non-200, a timeout or a body that is not JSON. Shared by the v1
 * airline sync, the v2 loader and the admin's repository test.
 */
export function fetchJson(url: string): Promise<unknown> {
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
      let data = "";
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as unknown);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(10000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
    req.on("error", reject);
  });
}
