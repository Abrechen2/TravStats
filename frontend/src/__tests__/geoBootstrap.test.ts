import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
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
});
