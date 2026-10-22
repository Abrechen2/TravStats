import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import http from "http";
import https from "https";
import type { AddressInfo } from "net";

import { guardedAgents, isBlockedAddress, normalizeWebdavUrl } from "../targetPolicy";
import { WebdavSyncError, classifyWebdavError } from "../errors";

const user = { allowPrivate: false };
const admin = { allowPrivate: true };

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof WebdavSyncError ? error.code : "other";
  }
}

describe("normalizeWebdavUrl — who may reach what (forgejo#321)", () => {
  it("accepts a public https share for an ordinary account and keeps its path", () => {
    expect(normalizeWebdavUrl("https://cloud.example.com/remote.php/dav/files/me/", user)).toBe(
      "https://cloud.example.com/remote.php/dav/files/me"
    );
  });

  it.each([
    ["http://10.0.0.5/dav", "blockedTarget"],
    ["https://192.168.178.202/dav", "blockedTarget"],
    ["https://127.0.0.1/dav", "blockedTarget"],
    ["https://169.254.169.254/latest/meta-data", "blockedTarget"],
    ["https://[::1]/dav", "blockedTarget"],
    ["https://[fd00::1]/dav", "blockedTarget"],
    ["https://[::ffff:10.0.0.1]/dav", "blockedTarget"],
    ["https://localhost/dav", "blockedTarget"],
    ["https://nas/dav", "blockedTarget"],
    ["https://nextcloud.local/dav", "blockedTarget"],
    ["http://cloud.example.com/dav", "httpsRequired"],
    ["ftp://cloud.example.com/dav", "invalidUrl"],
    ["https://me:secret@cloud.example.com/dav", "invalidUrl"],
    ["https://cloud.example.com/dav?x=1", "invalidUrl"],
    ["not a url", "invalidUrl"],
  ])("refuses %s for an ordinary account (%s)", (url, code) => {
    expect(codeOf(() => normalizeWebdavUrl(url, user))).toBe(code);
  });

  it("lets an admin name a LAN share, over plain http too", () => {
    expect(normalizeWebdavUrl("http://192.168.178.202:8080/dav/", admin)).toBe(
      "http://192.168.178.202:8080/dav"
    );
  });

  it("still asks an admin for https towards a public host — the password would travel in clear", () => {
    expect(codeOf(() => normalizeWebdavUrl("http://cloud.example.com/dav", admin))).toBe(
      "httpsRequired"
    );
  });
});

describe("isBlockedAddress", () => {
  it.each([
    ["8.8.8.8", false],
    ["2a00:1450:4001::1", false],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["::", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    ["not-an-ip", true],
  ])("%s → %s", (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });
});

/**
 * The URL check alone cannot stop a public NAME that resolves to a private
 * address, or a redirect to one: the guard sits in the agent and refuses at
 * connection time. Proved against a real listener on loopback, which an
 * ordinary account must never reach.
 */
describe("guardedAgents — refusal when the socket opens", () => {
  let server: http.Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1;
      res.end("reached");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function get(host: string, agent: http.Agent | undefined): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const req = http.get({ host, port, path: "/", agent }, (res) => {
          res.resume();
          res.on("end", () => resolve("reached"));
        });
        req.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function getTls(host: string, agent: https.Agent): Promise<unknown> {
    return new Promise((resolve) => {
      try {
        const req = https.get({ host, port, path: "/", agent }, () => resolve("connected"));
        req.on("error", resolve);
      } catch (error) {
        resolve(error);
      }
    });
  }

  it("refuses a loopback literal for an ordinary account", async () => {
    const error = await getTls("127.0.0.1", guardedAgents(user).httpsAgent);
    expect(classifyWebdavError(error)).toBe("blockedTarget");
  });

  it("refuses a name that RESOLVES to loopback (the rebinding case)", async () => {
    const error = await getTls("localhost", guardedAgents(user).httpsAgent);
    expect(classifyWebdavError(error)).toBe("blockedTarget");
  });

  it("lets an admin's sync reach a LAN share over http", async () => {
    await expect(get("127.0.0.1", guardedAgents(admin).httpAgent)).resolves.toBe("reached");
  });

  // A redirect is a new connection through the same agent: an https share
  // answering 307 to plain http must not get the export in clear (Codex review).
  it("refuses plain http on any connection of an ordinary account — redirects included", async () => {
    const before = hits;
    const error = await get("127.0.0.1", guardedAgents(user).httpAgent).catch((e: unknown) => e);
    expect(classifyWebdavError(error)).toBe("httpsRequired");
    expect(hits).toBe(before);
  });

  it("refuses an admin's http connection to a host off the LAN", async () => {
    const error = await get("example.com", guardedAgents(admin).httpAgent).catch((e: unknown) => e);
    expect(classifyWebdavError(error)).toBe("httpsRequired");
  });
});

describe("classifyWebdavError — one reason per failure", () => {
  it.each([
    [{ status: 401 }, "auth"],
    [{ status: 403 }, "auth"],
    [{ status: 507 }, "quota"],
    [{ status: 413 }, "tooLarge"],
    [{ status: 409 }, "path"],
    [{ status: 502 }, "server"],
    [{ status: 302 }, "protocol"],
    [{ code: "ENOTFOUND" }, "unreachable"],
    [{ code: "ECONNREFUSED" }, "unreachable"],
    [{ name: "TimeoutError" }, "timeout"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls"],
    [{ code: "blockedTarget", name: "FetchError" }, "blockedTarget"],
    [{ message: "x", cause: { code: "ECONNRESET" } }, "unreachable"],
    [new Error("something odd"), "protocol"],
  ])("%j → %s", (error, code) => {
    expect(classifyWebdavError(error)).toBe(code);
  });
});
