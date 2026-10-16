import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const NGINX = readFileSync(resolve(ROOT, "../nginx-combined.conf"), "utf8");

describe("map bootstrap scripts", () => {
  // geo-bootstrap.js keeps its name across builds; from the `\.js$` block it was
  // `immutable` for a year, so a browser never learned a changed bootstrap.
  it("nginx serves geo-bootstrap.js no-cache from an exact location", () => {
    const block = /location = \/geo-bootstrap\.js \{([\s\S]*?)\}/.exec(NGINX);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('Cache-Control "no-cache"');
    expect(block![1]).toContain("X-Content-Type-Options");
    expect(NGINX.indexOf("location = /geo-bootstrap.js")).toBeLessThan(
      NGINX.search(/location ~\* \\.\(js\|css/)
    );
  });
  // The two runtime scripts were parser-blocking: a slow or failing backend
  // held the first paint. Deferred, they still run in document order before
  // the module entry, which the build injects at the end of <head>.
  it("loads the runtime configuration deferred, in order, before the entry", () => {
    const head = INDEX.slice(0, INDEX.indexOf("</head>"));
    const bootstrap = head.indexOf('<script src="/geo-bootstrap.js"></script>');
    const geo = head.indexOf('<script defer src="/api/v1/geo-server/runtime"></script>');
    const config = head.indexOf('<script defer src="/api/v1/map-config/runtime"></script>');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(geo).toBeGreaterThan(bootstrap);
    expect(config).toBeGreaterThan(geo);
    expect(INDEX).not.toMatch(/<script src="\/api\//);
    expect(INDEX.indexOf('<script type="module"')).toBeGreaterThan(config);
  });
});
