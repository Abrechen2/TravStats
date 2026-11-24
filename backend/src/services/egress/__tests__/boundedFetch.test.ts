import http from "http";
import zlib from "zlib";
import type { AddressInfo } from "net";
import { boundedFetch, BoundedFetchError } from "../boundedFetch";

/**
 * The bounds every calendar and plugin request carries (spec
 * 2026-11-23-plugins-and-calendar.md, security review).
 */
let server: http.Server;
let base: string;
const LAN = { allowPrivate: true };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/bomb") {
      // 20 MB of zeros, a few KB on the wire.
      const packed = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024));
      res.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": packed.length });
      return res.end(packed);
    }
    if (req.url === "/slow") {
      setTimeout(() => res.end("late"), 2000);
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(301, { Location: "http://169.254.169.254/" });
      return res.end();
    }
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof BoundedFetchError ? e.reason : String(e);
  }
};

describe("boundedFetch", () => {
  it("caps the decompressed bytes, not the bytes on the wire", async () => {
    expect(
      await reason(
        boundedFetch(`${base}/bomb`, { policy: LAN, timeoutMs: 5000, maxBytes: 1024 * 1024 })
      )
    ).toBe("tooLarge");
  });

  it("stops at the time cap", async () => {
    expect(
      await reason(boundedFetch(`${base}/slow`, { policy: LAN, timeoutMs: 200, maxBytes: 1000 }))
    ).toBe("timeout");
  });

  it("never follows a redirect: the 3xx comes back as itself", async () => {
    const res = await boundedFetch(`${base}/redirect`, {
      policy: LAN,
      timeoutMs: 2000,
      maxBytes: 1000,
    });
    expect(res.status).toBe(301);
  });

  it("refuses a private target for a public-only caller before connecting", async () => {
    expect(
      await reason(
        boundedFetch(`${base}/`, {
          policy: { allowPrivate: false },
          timeoutMs: 2000,
          maxBytes: 1000,
        })
      )
    ).toBe("privateTarget");
  });

  it("refuses credentials in the URL, a non-http scheme, and http where https is required", async () => {
    const r = { policy: LAN, timeoutMs: 1000, maxBytes: 100 };
    expect(await reason(boundedFetch("http://u:p@127.0.0.1/", r))).toBe("invalidUrl");
    expect(await reason(boundedFetch("file:///etc/passwd", r))).toBe("invalidUrl");
    expect(await reason(boundedFetch(`${base}/`, { ...r, httpsOnly: true }))).toBe("invalidUrl");
  });
});
