import fs from "fs";
import path from "path";
import logger from "../../utils/logger";
import type { LogoVariant } from "./airlineLogoService";
import type { CachedLogo } from "./logoCache";

/**
 * The keyless DEFAULT tier of the airline-logo chain: SVG logos vendored into
 * this repository, served with no network call, no API key and no external
 * hotlink.
 *
 * The assets come from `soaring-symbols` (MIT, © 2024 Anh Thang) and are
 * SNAPSHOTTED rather than depended on. Two reasons, both learned the hard way:
 *
 *  1. The npm package cannot be consumed from this backend at all — it is
 *     CommonJS-declared but its `dist/index.cjs` contains ESM `import` syntax,
 *     so `require()` throws outright, and its `exports` map blocks reaching the
 *     data file directly. That is the same shape as the `searoute-ts` breakage
 *     that silently degraded every cruise route for weeks.
 *  2. It is a two-week-old alpha with a single maintainer. Vendoring the assets
 *     (as we already do for OurAirports and the marnet graph) means an upstream
 *     change cannot move under us, and the instance works offline.
 *
 * Refresh with `npm run refresh:airline-logos`, which re-vendors from the npm
 * tarball and re-stamps `data/airline-logos/VERSION`.
 *
 * Coverage is deliberately partial — 93 curated airlines. Measured against the
 * production data that is 86 % of flights; the rest falls through to the next
 * tier, which is exactly what the chain is for. Do not paper over a miss.
 */

const ASSET_ROOT = path.join(__dirname, "..", "..", "..", "data", "airline-logos");
const ASSET_DIR = path.join(ASSET_ROOT, "assets");

interface VendoredAirline {
  readonly name: string;
  readonly iata?: string;
  readonly icao?: string;
  readonly slug: string;
  readonly branding?: { readonly primary_color?: string };
}

/** What the frontend needs to render a vendored mark as a brand tile. */
export interface VendoredBrand {
  readonly color: string;
}

/**
 * Our four public variants map onto the snapshot's file names. `logo-white` maps
 * to the monochrome wordmark — the snapshot has no white-specific asset, and a
 * monochrome SVG is what a dark surface actually needs. `tail` exists for three
 * airlines; every other code misses and falls through.
 */
const VARIANT_FILES: Record<LogoVariant, string> = {
  icon: "icon.svg",
  logo: "logo.svg",
  "logo-white": "logo-mono.svg",
  tail: "tail.svg",
};

/** code (IATA or ICAO, upper-case) → slug. Built once at module load. */
let index: Map<string, string> | null = null;
let brands: Map<string, VendoredBrand> = new Map();
let airlineCount = 0;

function buildIndex(): Map<string, string> {
  const map = new Map<string, string>();
  brands = new Map();
  try {
    const raw = fs.readFileSync(path.join(ASSET_ROOT, "airlines.json"), "utf8");
    const airlines = JSON.parse(raw) as VendoredAirline[];
    airlineCount = airlines.length;
    for (const airline of airlines) {
      const color = airline.branding?.primary_color;
      for (const code of [airline.iata, airline.icao]) {
        if (!code) continue;
        map.set(code.toUpperCase(), airline.slug);
        if (color) brands.set(code.toUpperCase(), { color });
      }
    }
  } catch (error) {
    // A missing snapshot must not take the whole logo route down — the chain
    // simply loses its default tier and falls through to the remote providers.
    logger.warn(
      { error, path: ASSET_ROOT },
      "vendored airline logos unavailable — falling through to the remote tiers"
    );
  }
  return map;
}

function getIndex(): Map<string, string> {
  if (!index) index = buildIndex();
  return index;
}

/** Number of airlines in the vendored snapshot. */
export function vendoredAirlineCount(): number {
  getIndex();
  return airlineCount;
}

/**
 * Brand colour per code, for every airline whose mark we vendor.
 *
 * The frontend needs this to paint the departures-board tile: the snapshot ships
 * square brand MARKS (Lufthansa's crane), not wordmarks, so the tile carries the
 * airline's colour and the mark sits on it. It must only do that when the mark
 * is what will actually be served — with a logostream key configured, the
 * premium tier answers first and returns a wordmark instead. That is why the
 * manifest also reports whether a key is present.
 */
export function vendoredBrands(): Record<string, VendoredBrand> {
  getIndex();
  return Object.fromEntries(brands);
}

/**
 * Resolve a logo from the vendored snapshot, or null when the snapshot holds
 * neither the airline nor that variant of it.
 */
export function getVendoredLogo(code: string, variant: LogoVariant): CachedLogo | null {
  const slug = getIndex().get(code.trim().toUpperCase());
  if (!slug) return null;

  // The slug comes from our own snapshot, never from the caller, so it cannot
  // carry a traversal — but resolve and re-check anyway: this function's only
  // argument is user input, and a future refactor that indexes by a caller-
  // supplied value must not turn into an arbitrary file read.
  const file = path.resolve(ASSET_DIR, slug, VARIANT_FILES[variant]);
  if (!file.startsWith(path.resolve(ASSET_DIR) + path.sep)) return null;

  try {
    const body = fs.readFileSync(file);
    return { body, contentType: "image/svg+xml" };
  } catch {
    // The variant is genuinely absent for this airline (only 3 airlines ship a
    // tail, 39 a monochrome wordmark). A miss, not an error.
    return null;
  }
}
