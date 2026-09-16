import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The web app manifest, and the three ways it fails without a sound.
 *
 * There is no console error for any of them: an icon path that 404s, an icon
 * that is not square, or a manifest nginx serves as octet-stream — the browser
 * simply declines to offer "install" and says nothing. So each is asserted
 * here rather than trusted.
 */

const ROOT = resolve(__dirname, "../..");
const PUBLIC = resolve(ROOT, "public");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(
  readFileSync(resolve(PUBLIC, "manifest.webmanifest"), "utf8")
) as Manifest;

const indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf8");

/** Width and height straight out of the PNG header — no image library needed. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("is linked from the document", () => {
    expect(indexHtml).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);
  });

  it("names the app and opens it standalone", () => {
    expect(manifest.name).toBe("TravStats");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  // Dark-only is a brand decision (BRAND.md §1.1), and the splash screen the
  // launcher paints from these two values is the first thing a user sees.
  it("paints the splash in the brand background, not white", () => {
    expect(manifest.background_color).toBe("#0d1117");
    expect(manifest.theme_color).toBe("#0d1117");
    expect(indexHtml).toContain('<meta name="theme-color" content="#0d1117" />');
  });

  it("ships every icon it declares", () => {
    for (const icon of manifest.icons) {
      const path = resolve(PUBLIC, icon.src.replace(/^\//, ""));
      expect(existsSync(path), `${icon.src} is declared but missing`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  // An icon whose real pixels disagree with its `sizes` is treated as a
  // mismatch and skipped. /logo.png was 512x597 — that is why it could never
  // serve as one.
  it("declares each icon at the size it actually is, and square", () => {
    for (const icon of manifest.icons) {
      const { width, height } = pngSize(resolve(PUBLIC, icon.src.replace(/^\//, "")));
      expect(width, `${icon.src} is not square`).toBe(height);
      expect(`${width}x${height}`, `${icon.src} declares ${icon.sizes}`).toBe(icon.sizes);
    }
  });

  it("offers the two sizes an installable app needs, plus a maskable one", () => {
    const anySizes = manifest.icons.filter((i) => i.purpose !== "maskable").map((i) => i.sizes);
    expect(anySizes).toContain("192x192");
    expect(anySizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  // iOS never reads the manifest, so its icon is a separate link — and it must
  // be square, which /logo.png was not.
  it("gives iOS a square icon of its own", () => {
    const match = /<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/.exec(indexHtml);
    expect(match, "no apple-touch-icon link").not.toBeNull();
    const path = resolve(PUBLIC, (match?.[1] ?? "").replace(/^\//, ""));
    expect(existsSync(path)).toBe(true);
    const { width, height } = pngSize(path);
    expect(width).toBe(height);
  });

  // nginx 1.22 — the version in the production image — has no `webmanifest`
  // entry in mime.types, so without this location the file goes out as
  // octet-stream and `nosniff` makes the browser refuse it.
  it("is served with the manifest media type by the production nginx", () => {
    const conf = readFileSync(resolve(ROOT, "..", "nginx-combined.conf"), "utf8");
    const block = /location = \/manifest\.webmanifest \{([\s\S]*?)\n {4}\}/.exec(conf);
    expect(block, "no nginx location for the manifest").not.toBeNull();
    expect(block?.[1]).toContain("default_type application/manifest+json");
    // A location that sets its own add_header loses the inherited ones — the
    // same trap the file warns about above /index.html.
    expect(block?.[1]).toContain("X-Content-Type-Options");
    expect(block?.[1]).toContain("Content-Security-Policy");
  });
});
