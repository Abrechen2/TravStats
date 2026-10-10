import vm from "node:vm";

import { describe, expect, it } from "@jest/globals";
import request from "supertest";

import { shareLinkApp } from "../../../routes/__tests__/shareLinkFixtures";
import { SHARE_PAGE_CSP } from "../../../routes/sharePage";
import { SHARE_PAGE_HTML, SHARE_PAGE_JS } from "../sharePageAssets";

/**
 * The page a public share link opens (forgejo#281, design §2 T2/T3/T10–T12,
 * §4): a shell with no data, its own strict headers, one external script.
 */
describe("GET /share", () => {
  const app = shareLinkApp();

  it("answers the shell with no-store, noindex, no-referrer and a strict CSP", async () => {
    for (const path of ["/share", "/share/"]) {
      const res = await request(app).get(path).expect(200);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe(SHARE_PAGE_CSP);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    }
  });

  it("serves its script and style from its own origin", async () => {
    const js = await request(app).get("/share/share.js").expect(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(js.headers["content-security-policy"]).toBe(SHARE_PAGE_CSP);
    await request(app)
      .get("/share/share.css")
      .expect(200)
      .expect("Content-Type", /text\/css/);
  });

  it("carries no inline script, no third-party resource and no data", () => {
    const scripts = [...SHARE_PAGE_HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toContain('src="/share/share.js"');
    expect(scripts[0][2].trim()).toBe("");
    expect(SHARE_PAGE_HTML).not.toMatch(/https?:\/\//);
    expect(SHARE_PAGE_HTML).not.toMatch(/\son\w+=/i); // no inline handlers
  });

  it("CSP allows only self and blob: images, and nothing inline", () => {
    expect(SHARE_PAGE_CSP).toContain("default-src 'none'");
    expect(SHARE_PAGE_CSP).toContain("script-src 'self'");
    expect(SHARE_PAGE_CSP).not.toContain("unsafe-inline");
    expect(SHARE_PAGE_CSP).not.toContain("unsafe-eval");
    expect(SHARE_PAGE_CSP).toContain("frame-ancestors 'none'");
  });

  it("ships a script that parses, reads the token from the fragment and never writes HTML", () => {
    expect(() => new vm.Script(SHARE_PAGE_JS)).not.toThrow();
    expect(SHARE_PAGE_JS).toContain("location.hash");
    expect(SHARE_PAGE_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(SHARE_PAGE_JS).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    // The token goes in a POST body, never into a URL.
    expect(SHARE_PAGE_JS).not.toMatch(/share-links\/[a-z]+\?|\+ ?token/);
    expect(SHARE_PAGE_JS).toContain('credentials: "omit"');
  });
});
