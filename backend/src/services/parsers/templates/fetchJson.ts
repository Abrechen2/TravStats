import https from "https";

/**
 * GET a JSON document over https, rejecting on any non-200, a timeout or a
 * body that is not JSON. Shared by the v1 airline sync and the v2 loader.
 */
export function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
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
