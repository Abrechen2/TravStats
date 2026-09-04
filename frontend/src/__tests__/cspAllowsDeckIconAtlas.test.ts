import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The document CSP (nginx-combined.conf, forgejo#29) must let deck.gl fetch
 * its icon atlases. An IconLayer loads its atlas with `fetch()`, and this app
 * hands it inline SVGs as `data:` URLs — the cruise direction arrows and the
 * aeroplane marker. `img-src data:` does not cover a fetch; only
 * `connect-src` does. The first CSP that reached the RC server (rc.28,
 * 2026-09-04) allowed `'self' https: http: ws: wss:` and every arrow on the
 * map vanished with "deck: Failed to fetch" in the console, which no test
 * and no reading of the header had shown.
 *
 * The header is checked where it is written, once per `add_header`, so a
 * later tightening cannot quietly take the scheme away again.
 */
const conf = readFileSync(join(__dirname, "..", "..", "..", "nginx-combined.conf"), "utf8");

const cspHeaders = [...conf.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(
  (m) => m[1]
);

const directive = (csp: string, name: string): string[] => {
  const part = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + " "));
  return part ? part.slice(name.length).trim().split(/\s+/) : [];
};

describe("document CSP lets deck.gl fetch its icon atlases", () => {
  it("finds the CSP header in the nginx config — the scan must not match nothing", () => {
    expect(cspHeaders.length).toBeGreaterThan(0);
  });

  it("allows data: and blob: in connect-src on every CSP header", () => {
    for (const csp of cspHeaders) {
      const sources = directive(csp, "connect-src");
      expect(sources, csp).toContain("data:");
      expect(sources, csp).toContain("blob:");
    }
  });

  it("is guarding something real: a deck layer still builds its icon from a data: SVG", () => {
    const layer = readFileSync(
      join(__dirname, "..", "components", "layers", "cruiseArcsLayer.ts"),
      "utf8"
    );
    expect(layer).toContain("data:image/svg+xml");
  });
});
