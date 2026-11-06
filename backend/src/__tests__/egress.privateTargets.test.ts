/**
 * The SSRF boundary of the Immich and Dawarich clients (forgejo#411), against
 * real local HTTP servers — the bug lives in the transport (redirects, DNS,
 * stream), which a mocked axios or fetch cannot see.
 */
import { describe, it, expect, jest, afterEach, beforeAll, afterAll } from "@jest/globals";
import axios from "axios";
import dns from "dns";
import http from "http";
import type { AddressInfo } from "net";

import { createImmichClient } from "../services/immich/immichClient";
import { ImmichError, normalizeImmichBaseUrl } from "../services/immich/types";
import { createDawarichClient } from "../services/dawarich/dawarichClient";
import { DawarichError, normalizeDawarichBaseUrl } from "../services/dawarich/errors";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function listen(handler: Handler): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** The "internal" service a redirect points at; counts the hits it gets. */
let internal: { server: http.Server; url: string };
let internalHits = 0;

beforeAll(async () => {
  internal = await listen((_req, res) => {
    internalHits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ major: 1, minor: 0, patch: 0, status: "ok" }));
  });
});

afterAll(async () => {
  await new Promise((resolve) => internal.server.close(resolve));
});

const servers: http.Server[] = [];
afterEach(async () => {
  jest.restoreAllMocks();
  internalHits = 0;
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((resolve) => s.close(resolve));
    })
  );
});

async function redirector(): Promise<string> {
  const { server, url } = await listen((_req, res) => {
    res.writeHead(302, { location: `${internal.url}/latest/meta-data` });
    res.end();
  });
  servers.push(server);
  return url;
}

/** Make a public-looking name resolve to loopback — a rebinding DNS answer. */
function resolveToLoopback(name: string): void {
  const real = dns.lookup;
  jest.spyOn(dns, "lookup").mockImplementation(((
    hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void
  ) => {
    if (hostname !== name) return (real as (...a: unknown[]) => void)(hostname, options, callback);
    const all = typeof options === "object" && options !== null && "all" in options;
    if (all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  }) as unknown as typeof dns.lookup);
}

describe("Immich client (forgejo#411)", () => {
  it("refuses a redirect to an internal target instead of following it", async () => {
    const baseUrl = await redirector();
    const client = createImmichClient({
      baseUrl,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    await expect(client.getServerVersion()).rejects.toMatchObject({ kind: "protocol" });
    expect(internalHits).toBe(0);
  });

  it("refuses a redirect on the asset stream too", async () => {
    const baseUrl = await redirector();
    const client = createImmichClient({
      baseUrl,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    await expect(client.fetchAssetStream("a1", "thumbnail")).rejects.toMatchObject({
      kind: "protocol",
    });
    expect(internalHits).toBe(0);
  });

  it("refuses a public-looking name that resolves to a private address for an ordinary account", async () => {
    const { port } = internal.server.address() as AddressInfo;
    resolveToLoopback("immich.example.com");
    const client = createImmichClient({
      baseUrl: `http://immich.example.com:${port}`,
      apiKey: "k",
      source: "user",
      allowPrivate: false,
    });

    await expect(client.getServerVersion()).rejects.toMatchObject({
      kind: "invalidUrl",
      code: "PRIVATE_TARGET",
    });
    expect(internalHits).toBe(0);
  });

  it("refuses a stored private URL of an ordinary account on every request", async () => {
    const client = createImmichClient({
      baseUrl: internal.url,
      apiKey: "k",
      source: "user",
      allowPrivate: false,
    });
    await expect(client.listAlbums()).rejects.toMatchObject({
      kind: "invalidUrl",
      code: "PRIVATE_TARGET",
    });
    expect(internalHits).toBe(0);
  });

  it("lets an admin connection reach a LAN server", async () => {
    const client = createImmichClient({
      baseUrl: internal.url,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });
    await expect(client.getServerVersion()).resolves.toBe("1.0.0");
  });

  it("refuses to proxy an SVG, which is an image that runs script", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    });
    servers.push(server);
    const client = createImmichClient({
      baseUrl: url,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    await expect(client.fetchAssetStream("a1", "original")).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("never sends an ordinary account's request through an env proxy", async () => {
    const get = jest
      .spyOn(axios, "get")
      .mockResolvedValue({ data: { major: 1, minor: 2, patch: 3 } });
    const restricted = createImmichClient({
      baseUrl: "https://photos.example.com",
      apiKey: "k",
      source: "user",
      allowPrivate: false,
    });
    await restricted.getServerVersion();
    expect(get.mock.calls[0][1]).toMatchObject({ proxy: false, maxRedirects: 0 });
  });

  it("refuses to proxy an asset whose content type is not image or video", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<script>alert(1)</script>");
    });
    servers.push(server);
    const client = createImmichClient({
      baseUrl: url,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    const failure = await client.fetchAssetStream("a1", "original").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ImmichError);
    expect(failure).toMatchObject({ kind: "protocol" });
  });

  it("still streams an image", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "image/webp", "content-length": "3" });
      res.end("abc");
    });
    servers.push(server);
    const client = createImmichClient({
      baseUrl: url,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    const upstream = await client.fetchAssetStream("a1", "thumbnail");
    expect(upstream.contentType).toBe("image/webp");
    const chunks: Buffer[] = [];
    for await (const chunk of upstream.stream as AsyncIterable<Buffer>) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
  });

  it("tears down an asset stream that stalls mid-body", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": "1000" });
      res.write("partial"); // …and never another byte
    });
    servers.push(server);
    const client = createImmichClient(
      { baseUrl: url, apiKey: "k", source: "global", allowPrivate: true },
      { streamIdleTimeoutMs: 150 }
    );

    const upstream = await client.fetchAssetStream("a1", "original");
    const drained = (async () => {
      for await (const _chunk of upstream.stream as AsyncIterable<Buffer>) {
        // drain
      }
    })();
    await expect(drained).rejects.toBeTruthy();
  }, 5_000);
});

describe("Dawarich client (forgejo#411)", () => {
  it("refuses a redirect to an internal target instead of following it", async () => {
    const baseUrl = await redirector();
    const client = createDawarichClient({
      baseUrl,
      apiKey: "k",
      source: "global",
      allowPrivate: true,
    });

    const failure = await client.checkHealth().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DawarichError);
    expect(failure).toMatchObject({ kind: "protocol" });
    expect(internalHits).toBe(0);
  });

  it("refuses a public-looking name that resolves to a private address for an ordinary account", async () => {
    const { port } = internal.server.address() as AddressInfo;
    resolveToLoopback("dawarich.example.com");
    const client = createDawarichClient({
      baseUrl: `http://dawarich.example.com:${port}`,
      apiKey: "k",
      source: "user",
      allowPrivate: false,
    });

    await expect(client.checkHealth()).rejects.toMatchObject({
      kind: "invalidUrl",
      code: "PRIVATE_TARGET",
    });
    expect(internalHits).toBe(0);
  });
});

describe("base URL normalisers (forgejo#411)", () => {
  it.each([
    "http://10.0.0.1",
    "http://172.16.5.5:2283",
    "http://192.168.178.10",
    "http://127.0.0.1:8080",
    "http://169.254.169.254",
    "http://[::1]:2283",
    "http://[fd00::1]",
    "http://localhost:2283",
    "http://immich.local",
    "http://nas",
  ])("refuses %s for an ordinary account and accepts it for an admin", (url) => {
    expect(() => normalizeImmichBaseUrl(url, { allowPrivate: false })).toThrow(
      expect.objectContaining({ kind: "invalidUrl", code: "PRIVATE_TARGET" })
    );
    expect(() => normalizeDawarichBaseUrl(url, { allowPrivate: false })).toThrow(
      expect.objectContaining({ kind: "invalidUrl", code: "PRIVATE_TARGET" })
    );
    expect(() => normalizeImmichBaseUrl(url, { allowPrivate: true })).not.toThrow();
    expect(() => normalizeDawarichBaseUrl(url, { allowPrivate: true })).not.toThrow();
  });

  it("accepts a public address for an ordinary account", () => {
    expect(normalizeImmichBaseUrl("https://photos.example.com/", { allowPrivate: false })).toBe(
      "https://photos.example.com"
    );
  });
});

describe("the services page's account fields (forgejo#411)", () => {
  it.each(["immich", "dawarich"])(
    "refuses a private %s URL for an ordinary account with PRIVATE_TARGET, accepts it for an admin",
    async (id) => {
      const { getService } = await import("../services/externalServices/catalogue");
      const { collectWrites } = await import("../services/externalServices/fields");
      const service = getService(id)!;
      const fields = { baseUrl: "http://10.0.0.5:2283" };

      expect(() =>
        collectWrites(service, service.accountFields, fields, { allowPrivate: false })
      ).toThrow(expect.objectContaining({ statusCode: 400, code: "PRIVATE_TARGET" }));
      expect(
        collectWrites(service, service.accountFields, fields, { allowPrivate: true }).user
      ).toEqual({ [`${id}BaseUrl`]: "http://10.0.0.5:2283" });
    }
  );
});
