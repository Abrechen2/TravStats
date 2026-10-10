import type { NextFunction, Request, Response } from "express";

import { API_V1 } from "../services/files/privateFileUrls";

/**
 * The API never answers private data at a URL that ends like a static asset
 * (forgejo#284).
 *
 * Caches in front of a self-hosted instance decide by extension, not by the
 * app's headers:
 *
 * - Nginx Proxy Manager's "Cache Assets" switch adds
 *   `location ~* \.(css|js|jpe?g|gif|png|webp|woff2?|eot|ttf|svg|ico|css\.map|js\.map)$`
 *   with `proxy_cache` keyed on host + URI, `proxy_ignore_headers Set-Cookie
 *   Cache-Control Expires` and `proxy_hide_header Cache-Control`. The app's
 *   `no-store` is neither obeyed nor passed on.
 * - Cloudflare caches a fixed list of extensions by default (below, from
 *   developers.cloudflare.com/cache/concepts/default-cache-behavior/). It does
 *   honour `private`/`no-store` — unless a proxy in between removed them, which
 *   is exactly what the NPM block above does.
 *
 * So the app-side guarantee has to be about the URL itself. This middleware,
 * mounted on `/api` ahead of every router and of authentication, sorts each
 * GET/HEAD into one of four outcomes:
 *
 * 1. a legacy private-file URL → 308 to its extension-less canonical form.
 *    Unconditional, before authentication: a cached redirect leaks nothing,
 *    whereas a cached 401 would lock the owner out for the cache's lifetime.
 * 2. a public asset path → passed through (same bytes for everyone).
 * 3. any other path whose last segment ends in a cacheable extension → 404.
 *    This is what stops web cache deception: `/flights/<id>.png` must not
 *    reach a router whose `:id` param would happily carry the suffix.
 * 4. everything else → passed through.
 *
 * The route-table side of the same rule is pinned by
 * `__tests__/assetPathGuard.routes.test.ts`.
 */

/** Nginx Proxy Manager, `conf.d/include/assets.conf` ("Cache Assets"). */
const NPM_CACHE_ASSETS = [
  "css",
  "js",
  "jpg",
  "jpeg",
  "gif",
  "png",
  "webp",
  "woff",
  "woff2",
  "eot",
  "ttf",
  "svg",
  "ico",
  "map",
];

/** Cloudflare's default cached file extensions. */
const CLOUDFLARE_DEFAULT = [
  "7z",
  "avi",
  "avif",
  "apk",
  "bin",
  "bmp",
  "bz2",
  "class",
  "css",
  "csv",
  "doc",
  "docx",
  "dmg",
  "ejs",
  "eot",
  "eps",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "iso",
  "jar",
  "jpg",
  "jpeg",
  "js",
  "mid",
  "midi",
  "mkv",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "pict",
  "pls",
  "png",
  "ppt",
  "pptx",
  "ps",
  "rar",
  "svg",
  "svgz",
  "swf",
  "tar",
  "tif",
  "tiff",
  "ttf",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
  "zst",
];

export const STATIC_ASSET_EXTENSIONS: readonly string[] = [
  ...new Set([...NPM_CACHE_ASSETS, ...CLOUDFLARE_DEFAULT]),
].sort();

const STATIC_ASSET_SUFFIX = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS.join("|")})$`, "i");

/** Does this path segment (or path) end like a file a cache would keep? */
export const endsInStaticAssetExtension = (pathOrSegment: string): boolean =>
  STATIC_ASSET_SUFFIX.test(pathOrSegment);

export interface PublicAssetPath {
  /** OpenAPI-style path below `/api/v1`; a trailing `/*` covers a static mount. */
  path: string;
  reason: string;
}

/**
 * Paths that may end in an asset extension because what they serve is the
 * same for every caller. Every entry needs a reason; the route test fails on
 * an entry that names no mounted route.
 */
export const PUBLIC_ASSET_PATHS: readonly PublicAssetPath[] = [
  {
    path: "/login-backgrounds/{filename}",
    reason:
      "Public by design: the sign-in page shows these before anyone has a session, and " +
      "every visitor gets the same image.",
  },
  {
    path: "/docs/*",
    reason:
      "Swagger UI's static bundle (swagger-ui-express): stylesheets, scripts and an init " +
      "script carrying the public OpenAPI document — identical for every caller.",
  },
];

export interface LegacyFileRedirect {
  /** Former GET path below `/api/v1`, served by nothing but this redirect. */
  from: string;
  /** Its canonical GET path, which a router serves. */
  to: string;
  reason: string;
}

/**
 * Former file URLs that end in the file's extension. The router no longer
 * serves them; this middleware answers each with a permanent redirect.
 */
export const LEGACY_FILE_REDIRECTS: readonly LegacyFileRedirect[] = [
  {
    from: "/uploads/receipts/{filename}",
    to: "/uploads/receipts/{filename}/content",
    reason: "Pre-document receipts; their URL is stored in flights and lodging stays.",
  },
  {
    from: "/settings/profile-picture/{filename}",
    to: "/settings/profile-picture/{filename}/content",
    reason: "Avatars; the URL is stored in the settings blob and in clients' local state.",
  },
  {
    from: "/admin/logging/files/{filename}",
    to: "/admin/logging/files/{filename}/entries",
    reason: "A rotated log is `<name>.log.gz`, and `.gz` is on Cloudflare's default list.",
  },
];

const PARAM = /\{[A-Za-z0-9_]+\}/g;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `/a/{x}/b` → `^/api/v1/a/([^/]+)/b$`; a trailing `/*` matches the subtree. */
const compile = (pattern: string): RegExp => {
  const wildcard = pattern.endsWith("/*");
  const body = wildcard ? pattern.slice(0, -2) : pattern;
  const source = body.split(PARAM).map(escapeRegExp).join("([^/]+)");
  return new RegExp(`^${escapeRegExp(API_V1)}${source}${wildcard ? "(?:/.*)?" : ""}$`);
};

const PUBLIC_MATCHERS = PUBLIC_ASSET_PATHS.map((entry) => compile(entry.path));
const REDIRECT_MATCHERS = LEGACY_FILE_REDIRECTS.map((entry) => ({
  from: compile(entry.from),
  to: entry.to,
}));

export type AssetPathDecision =
  | { action: "redirect"; location: string }
  | { action: "public" }
  | { action: "refuse" }
  | { action: "pass" };

/**
 * Proxies match on the DECODED path (`%2E` is a dot to nginx and to
 * Cloudflare's URL normalisation), so the decision is taken on the decoded
 * form too — otherwise `/flights/<id>%2Epng` would slip past as "no
 * extension" and still be cached as one.
 */
const decodePath = (rawPath: string): string => {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
};

/** Pure decision for one request path (no query string), as the client sent it. */
export const classifyApiPath = (rawPath: string, rawQuery = ""): AssetPathDecision => {
  for (const { from, to } of REDIRECT_MATCHERS) {
    const match = from.exec(rawPath);
    if (match) {
      // The captured segments are re-used exactly as sent (still encoded), so
      // the target names the same file and cannot leave the prefix.
      let index = 1;
      const target = to.replace(PARAM, () => match[index++]);
      return { action: "redirect", location: `${API_V1}${target}${rawQuery}` };
    }
  }

  const decoded = decodePath(rawPath);
  if (PUBLIC_MATCHERS.some((matcher) => matcher.test(rawPath) || matcher.test(decoded))) {
    return { action: "public" };
  }
  if (endsInStaticAssetExtension(decoded) || endsInStaticAssetExtension(rawPath)) {
    return { action: "refuse" };
  }
  return { action: "pass" };
};

/** Mount with `app.use("/api", assetPathGuard)` — above every router. */
export const assetPathGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  const url = req.originalUrl;
  const queryAt = url.indexOf("?");
  const rawPath = queryAt === -1 ? url : url.slice(0, queryAt);
  const rawQuery = queryAt === -1 ? "" : url.slice(queryAt);

  const decision = classifyApiPath(rawPath, rawQuery);
  if (decision.action === "redirect") {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(308, decision.location);
    return;
  }
  if (decision.action === "refuse") {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
};
