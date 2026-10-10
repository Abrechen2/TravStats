import { Router, type Response } from "express";

import {
  SHARE_PAGE_CSS,
  SHARE_PAGE_HTML,
  SHARE_PAGE_JS,
} from "../services/shareLinks/sharePageAssets";

/**
 * `GET /share` — the page a public share link opens (forgejo#281). Mounted
 * in `index.ts` outside `/api` (it is a page, not an endpoint); nginx proxies
 * `/share` here (`nginx-combined.conf`).
 *
 * Its own headers on every answer, set after Helmet so they win: a CSP
 * stricter than the app's (`default-src 'none'`, script and style from self,
 * images from self and blob: for the photos the script fetches), no Referer,
 * no indexing, no framing, and no caching of the shell — it holds no data, but
 * a cached shell is one more copy of a URL that should leave no trace.
 */
export const SHARE_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The public share-link API, which the CORS middleware leaves alone (see index.ts). */
export function isPublicShareLinkPath(path: string): boolean {
  return path.startsWith("/api/v1/public/share-links/");
}

const router = Router();

function pageHeaders(res: Response, cache: "no-store" | "no-cache"): void {
  res.setHeader("Content-Security-Policy", SHARE_PAGE_CSP);
  res.setHeader("Cache-Control", cache);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

router.get(["/", ""], (_req, res) => {
  pageHeaders(res, "no-store");
  res.type("html").send(SHARE_PAGE_HTML);
});

router.get("/share.js", (_req, res) => {
  pageHeaders(res, "no-cache");
  res.type("application/javascript").send(SHARE_PAGE_JS);
});

router.get("/share.css", (_req, res) => {
  pageHeaders(res, "no-cache");
  res.type("text/css").send(SHARE_PAGE_CSS);
});

export default router;
