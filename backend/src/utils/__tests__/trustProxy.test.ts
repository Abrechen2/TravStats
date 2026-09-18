import express from "express";
import request from "supertest";

import { DEFAULT_TRUST_PROXY, resolveTrustProxy } from "../trustProxy";

/**
 * `req.ip` behind a proxy chain, and the parser that decides whom to believe.
 *
 * The behaviour half reproduces what was measured on prod on 2026-09-16: the
 * container's nginx appends the address of the reverse proxy in front of it,
 * and with only loopback trusted, that proxy's address is what every visitor
 * gets — one rate-limit bucket for all of them.
 */
function ipSeenWith(trust: number | string, forwardedFor: string): Promise<string> {
  const app = express();
  app.set("trust proxy", trust);
  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  return request(app)
    .get("/ip")
    .set("X-Forwarded-For", forwardedFor)
    .then((res) => (res.body as { ip: string }).ip);
}

// What the container's nginx forwards for a visitor 203.0.113.7 who came in
// through a reverse proxy at 192.168.1.10 (supertest's own peer is loopback,
// standing in for that nginx).
const THROUGH_NPM = "203.0.113.7, 192.168.1.10";

describe("req.ip behind a reverse proxy", () => {
  it("gives every visitor the proxy's address when only loopback is trusted", async () => {
    expect(await ipSeenWith(DEFAULT_TRUST_PROXY, THROUGH_NPM)).toBe("192.168.1.10");
  });

  it("finds the visitor once the proxy is named", async () => {
    const trust = resolveTrustProxy("loopback, 192.168.1.10");
    expect(await ipSeenWith(trust, THROUGH_NPM)).toBe("203.0.113.7");
  });

  it("is not fooled by an address the visitor forged in front", async () => {
    const trust = resolveTrustProxy("loopback, 192.168.1.10");
    expect(await ipSeenWith(trust, `198.51.100.66, ${THROUGH_NPM}`)).toBe("203.0.113.7");
  });

  it("accepts a CIDR for a proxy with a changing address", async () => {
    const trust = resolveTrustProxy("loopback, 192.168.1.0/24");
    expect(await ipSeenWith(trust, THROUGH_NPM)).toBe("203.0.113.7");
  });
});

describe("resolveTrustProxy", () => {
  it("defaults to loopback when unset or blank", () => {
    expect(resolveTrustProxy(undefined)).toBe("loopback");
    expect(resolveTrustProxy("   ")).toBe("loopback");
  });

  it("keeps named ranges, addresses and CIDRs, normalising the list", () => {
    expect(resolveTrustProxy("loopback,uniquelocal , 10.0.0.5")).toBe(
      "loopback, uniquelocal, 10.0.0.5"
    );
    expect(resolveTrustProxy("loopback, fd00::/8, 2001:db8::1")).toBe(
      "loopback, fd00::/8, 2001:db8::1"
    );
  });

  it("accepts a hop count of one or more", () => {
    expect(resolveTrustProxy("2")).toBe(2);
  });

  it.each(["true", "TRUE", "false", "0"])("refuses %s", (value) => {
    expect(() => resolveTrustProxy(value)).toThrow(/TRUST_PROXY/);
  });

  it.each(["npm.local", "300.1.1.1", "10.0.0.0/33", "10.0.0.0/8/1", "loopback, bogus"])(
    "refuses the unrecognised entry %s",
    (value) => {
      expect(() => resolveTrustProxy(value)).toThrow(/TRUST_PROXY/);
    }
  );
});
