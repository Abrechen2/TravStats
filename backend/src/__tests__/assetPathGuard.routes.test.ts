/**
 * No private file at a URL that ends like a static asset (forgejo#284).
 *
 * Reverse proxies and CDNs cache by the end of the path, not by the app's
 * headers: Nginx Proxy Manager's "Cache Assets" caches `\.(png|jpe?g|…)$` keyed
 * on host + URI and strips `Cache-Control`; Cloudflare caches `.pdf`, `.png`,
 * `.gz`, `.zip` … by default once that header is gone. A receipt at
 * `/uploads/receipts/<name>.png` was served to the next visitor with no
 * session, however carefully its route checked ownership.
 *
 * Two halves, because the hole has two shapes:
 *
 * 1. The ROUTE TABLE — no GET route may end in a cacheable extension or in a
 *    parameter that carries a file name, unless it is listed as public in
 *    `PUBLIC_ASSET_PATHS` with a reason. A new `/x/:filename` download fails
 *    here the day it is written.
 * 2. The REQUEST — any other parameter can still carry a suffix
 *    (`/flights/<id>.png`: web cache deception), so `assetPathGuard` refuses
 *    every such path before a router sees it. Pinned below with real requests.
 */

import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import {
  LEGACY_FILE_REDIRECTS,
  PUBLIC_ASSET_PATHS,
  STATIC_ASSET_EXTENSIONS,
  classifyApiPath,
  endsInStaticAssetExtension,
} from "../middleware/assetPathGuard";
import { listMountedEndpoints } from "../services/openapi/coverage";

/** A final parameter whose value is a file name — and so carries its extension. */
const FILE_NAME_PARAM = /\{(?:[A-Za-z]*[Ff]ile[A-Za-z]*|[A-Za-z]*[Nn]ame|path)\}$/;

const getRoutes = (): string[] =>
  listMountedEndpoints()
    .filter((e) => e.method === "get")
    .map((e) => e.path);

const isPublic = (path: string): boolean =>
  PUBLIC_ASSET_PATHS.some((entry) =>
    entry.path.endsWith("/*")
      ? path === entry.path.slice(0, -2) || path.startsWith(entry.path.slice(0, -1))
      : path === entry.path
  );

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the route table (forgejo#284)", () => {
  it("serves no private GET at a path ending in a cacheable extension or a file name", () => {
    const offenders = getRoutes().filter((path) => {
      if (isPublic(path)) return false;
      const last = path.split("/").pop() ?? "";
      return FILE_NAME_PARAM.test(last) || endsInStaticAssetExtension(last);
    });

    expect(offenders).toEqual([]);
  });

  it("gives every public exception a reason and a route that exists", () => {
    const routes = new Set(getRoutes());
    for (const entry of PUBLIC_ASSET_PATHS) {
      expect(entry.reason.length).toBeGreaterThan(20);
      // A wildcard entry covers a static mount (no GET route of its own).
      if (!entry.path.endsWith("/*")) expect(routes).toContain(entry.path);
    }
  });

  it("redirects only paths no router serves, to paths a router does serve", () => {
    const routes = new Set(getRoutes());
    for (const entry of LEGACY_FILE_REDIRECTS) {
      expect(routes).not.toContain(entry.from);
      expect(routes).toContain(entry.to);
      expect(endsInStaticAssetExtension(entry.to)).toBe(false);
      expect(entry.to.endsWith("}")).toBe(false);
    }
  });

  it("covers both proxies' lists", () => {
    // Nginx Proxy Manager "Cache Assets" and a sample of Cloudflare's defaults.
    for (const ext of [
      "png",
      "jpg",
      "jpeg",
      "svg",
      "js",
      "css",
      "map",
      "pdf",
      "gz",
      "zip",
      "xlsx",
    ]) {
      expect(STATIC_ASSET_EXTENSIONS).toContain(ext);
    }
    // Neither caches JSON by default; the spec lives at /openapi.json.
    expect(STATIC_ASSET_EXTENSIONS).not.toContain("json");
  });
});

describe("classifyApiPath", () => {
  it.each([
    "/api/v1/flights/abc.png",
    "/api/v1/evidence/country/DE.PDF",
    "/api/v1/admin/backup/x.zip",
    "/api/v1/trips/1/photos/2/file.jpg",
    // nginx and Cloudflare match the decoded path, so the guard does too.
    "/api/v1/flights/abc%2Epng",
    "/api/v1/flights/abc.p%6Eg",
  ])("refuses %s", (path) => {
    expect(classifyApiPath(path)).toEqual({ action: "refuse" });
  });

  it.each([
    "/api/v1/flights/abc",
    "/api/v1/openapi.json",
    "/api/v1/uploads/receipts/a.png/content",
  ])("passes %s", (path) => {
    expect(classifyApiPath(path)).toEqual({ action: "pass" });
  });

  it.each(["/api/v1/login-backgrounds/sunset.jpg", "/api/v1/docs/swagger-ui.css"])(
    "lets the public asset %s through",
    (path) => {
      expect(classifyApiPath(path)).toEqual({ action: "public" });
    }
  );

  it("redirects a legacy file URL and keeps the query and the encoding", () => {
    expect(classifyApiPath("/api/v1/uploads/receipts/1-ab-my%20bill.pdf", "?x=1")).toEqual({
      action: "redirect",
      location: "/api/v1/uploads/receipts/1-ab-my%20bill.pdf/content?x=1",
    });
  });
});

describe("assetPathGuard on real requests", () => {
  it("refuses a dotted suffix on an authenticated route before authentication runs", async () => {
    // Without the guard this reaches `authenticate` (401) — and with a cookie,
    // the route, whose `:key` param would carry the `.png` along.
    const res = await request(app).get("/api/v1/evidence/country/DE.png");

    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses HEAD the same way", async () => {
    const res = await request(app).head("/api/v1/flights/anything.jpg");
    expect(res.status).toBe(404);
  });

  it("leaves other methods alone", async () => {
    const res = await request(app).delete("/api/v1/uploads/receipts/x.png");
    expect(res.status).toBe(401);
  });

  it("does not touch an extension-less private route", async () => {
    const res = await request(app).get("/api/v1/evidence/country/DE");
    expect(res.status).toBe(401);
  });
});
