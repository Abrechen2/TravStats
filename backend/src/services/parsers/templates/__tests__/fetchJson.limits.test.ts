import { describe, it, expect, afterEach } from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";
import { fetchJson, FetchJsonError } from "../fetchJson";

/**
 * A template repository is admin-chosen and may be hostile or broken. A 200
 * that streams forever, slowly enough never to trip the inactivity timeout,
 * must end as a typed failure — not as a body held in memory until the
 * process dies.
 */
describe("fetchJson limits", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    const s = server;
    server = null;
    if (s) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/index.json`;
  }

  /** An endless body: 64 KiB every few milliseconds, never an end. */
  function endless(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { "content-type": "application/json" });
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const timer = setInterval(() => {
      if (res.destroyed) clearInterval(timer);
      else res.write(chunk);
    }, 2);
    res.on("close", () => clearInterval(timer));
  }

  it("refuses a body over the byte cap and destroys the response", async () => {
    const url = await serve(endless);
    const err = await fetchJson(url).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchJsonError);
    expect((err as FetchJsonError).reason).toBe("too_large");
  }, 15000);

  it("refuses a body that trickles past the absolute deadline", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const timer = setInterval(() => {
        if (res.destroyed) clearInterval(timer);
        else res.write(" ");
      }, 20);
      res.on("close", () => clearInterval(timer));
    });
    const err = await fetchJson(url, { deadlineMs: 300 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchJsonError);
    expect((err as FetchJsonError).reason).toBe("timeout");
  }, 15000);

  it("still reads a normal document", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: 2, templates: [] }));
    });
    await expect(fetchJson(url)).resolves.toEqual({ version: 2, templates: [] });
  });
});
