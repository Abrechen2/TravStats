import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * forgejo#415 N8: the document CSP must not allow plain `http:` or `ws:`
 * sources. The browser only reaches the same origin and public https hosts;
 * operator services (Immich, Dawarich, OSRM, Photon) are called by the server.
 * Checked on every `add_header Content-Security-Policy` — the header is
 * repeated per location because nginx does not inherit add_header.
 */
const conf = readFileSync(join(__dirname, "..", "..", "..", "nginx-combined.conf"), "utf8");
const cspHeaders = [...conf.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(
  (m) => m[1]
);

describe("document CSP has no plain-text network sources", () => {
  it("finds the CSP headers — the scan must not match nothing", () => {
    expect(cspHeaders.length).toBeGreaterThan(0);
  });

  it("allows neither http: nor ws: in any directive of any header", () => {
    for (const csp of cspHeaders) {
      const tokens = csp.split(/[\s;]+/);
      expect(tokens, csp).not.toContain("http:");
      expect(tokens, csp).not.toContain("ws:");
    }
  });
});
