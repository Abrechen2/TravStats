import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RELOAD_WINDOW_MS, STALE_RELOAD_KEY, STALE_RELOAD_PARAM } from "../lib/staleBundle";

/**
 * public/boot-guard.js — the static, unhashed script that rescues a tab whose
 * cached index.html names an entry module that no longer exists (a blank page
 * otherwise; staleBundle.ts lives INSIDE that module and cannot help).
 */
const ROOT = resolve(__dirname, "../..");
const SOURCE = readFileSync(resolve(ROOT, "public/boot-guard.js"), "utf8");
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const NGINX = readFileSync(resolve(ROOT, "../nginx-combined.conf"), "utf8");

interface Harness {
  fire: (target: Element) => void;
  replace: ReturnType<typeof vi.fn>;
  session: Map<string, string>;
  doc: Document;
}

function load(
  opts: { session?: Record<string, string>; lang?: string; stored?: string } = {}
): Harness {
  const doc = document.implementation.createHTMLDocument("t");
  const root = doc.createElement("div");
  root.id = "root";
  doc.body.appendChild(root);
  const session = new Map(Object.entries(opts.session ?? {}));
  const listeners: Array<(e: { target: Element }) => void> = [];
  const replace = vi.fn();
  const win = {
    document: doc,
    URL,
    navigator: { language: opts.lang ?? "en-US" },
    location: { href: "https://t.example/trips?x=1", origin: "https://t.example", replace },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
    },
    localStorage: { getItem: () => opts.stored ?? null },
    addEventListener: (type: string, fn: (e: { target: Element }) => void, capture: boolean) => {
      expect(type).toBe("error");
      expect(capture).toBe(true);
      listeners.push(fn);
    },
  };
  new Function("window", SOURCE)(win);
  return {
    fire: (target) => {
      listeners.forEach((fn) => fn({ target }));
      // A created document stays "loading"; the guard then waits for this.
      doc.dispatchEvent(new Event("DOMContentLoaded"));
    },
    replace,
    session,
    doc,
  };
}

function script(doc: Document, src: string): Element {
  const s = doc.createElement("script");
  s.setAttribute("type", "module");
  s.setAttribute("src", src);
  // jsdom resolves `src` against its own about:blank; pin it to the fake origin.
  Object.defineProperty(s, "src", { value: src });
  return s;
}

describe("boot-guard.js", () => {
  it("mirrors staleBundle.ts's marker, parameter and window, so the two share one guard", () => {
    expect(SOURCE).toContain(`"${STALE_RELOAD_KEY}"`);
    expect(SOURCE).toContain(`"${STALE_RELOAD_PARAM}"`);
    expect(SOURCE).toContain("5 * 60 * 1000");
    expect(RELOAD_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("reloads once, cache-busted, when the entry module of this origin fails", () => {
    const h = load();
    h.fire(script(h.doc, "https://t.example/assets/index-old.js"));
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(
      new URL(h.replace.mock.calls[0][0] as string).searchParams.get(STALE_RELOAD_PARAM)
    ).toBeTruthy();
    expect(h.session.get(STALE_RELOAD_KEY)).toBeTruthy();
  });

  it("inside the window it does not loop: it says what happened instead, in the stored language", () => {
    const h = load({
      session: { [STALE_RELOAD_KEY]: String(Date.now() - 1000) },
      stored: JSON.stringify({ state: { display: { language: "de" } } }),
    });
    h.fire(script(h.doc, "https://t.example/assets/index-old.js"));
    expect(h.replace).not.toHaveBeenCalled();
    const notice = h.doc.querySelector('[data-boot-guard="stale"]');
    expect(notice?.textContent).toContain("Eine neue Version ist da");
    (notice?.querySelector("button") as HTMLButtonElement).click();
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("falls back to the browser language when nothing is stored", () => {
    const h = load({ session: { [STALE_RELOAD_KEY]: String(Date.now()) }, lang: "en-GB" });
    h.fire(script(h.doc, "https://t.example/assets/index-old.js"));
    expect(h.doc.body.textContent).toContain("A new version is available");
  });

  it("ignores a third-party resource and anything after the app has booted", () => {
    const h = load();
    h.fire(script(h.doc, "https://unpkg.com/leaflet.js"));
    expect(h.replace).not.toHaveBeenCalled();
    h.doc.documentElement.setAttribute("data-ts-booted", "1");
    h.fire(script(h.doc, "https://t.example/assets/Lazy-old.js"));
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("is loaded as a plain same-origin script BEFORE the module entry, with no inline script", () => {
    const guard = INDEX.indexOf('<script src="/boot-guard.js"></script>');
    const entry = INDEX.indexOf('<script type="module"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(entry);
    for (const tag of INDEX.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      expect(tag).toMatch(/src="/);
      expect(
        tag
          .replace(/<script\b[^>]*>/, "")
          .replace("</script>", "")
          .trim()
      ).toBe("");
    }
  });

  it("nginx serves it no-cache (an exact location ahead of the immutable .js block), CSP unchanged", () => {
    const block = /location = \/boot-guard\.js \{([\s\S]*?)\}/.exec(NGINX);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('Cache-Control "no-cache"');
    expect(block![1]).not.toContain("immutable");
    // The guard needs no CSP change: one policy, word for word, on every block
    // that carries one, and it still refuses inline script.
    const policies = new Set(NGINX.match(/Content-Security-Policy "[^"]*"/g));
    expect(policies.size).toBe(1);
    const [policy] = [...policies];
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
