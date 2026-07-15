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
}

/**
 * The vendored snapshot is the ICON tier. It deliberately does NOT serve the
 * wordmark variants any more: its `logo.svg` was absent for 10 of the 93
 * airlines, and the marks it does ship are drawn in the brand's own colour, so
 * they needed a contrasting plate — the heuristic that shipped an invisible
 * logo in 2.5.0-beta.1. kiwi serves wordmark-shaped variants now; this tier
 * keeps what it is genuinely good at.
 *
 * `logo-white` maps to the monochrome mark: a dark surface wants a
 * single-colour glyph it can tint, and that needs no plate at all.
 */
const VARIANT_FILES: Partial<Record<LogoVariant, string>> = {
  icon: "icon.svg",
  "logo-white": "icon-mono.svg",
};

/** code (IATA or ICAO, upper-case) → slug. Built once at module load. */
let index: Map<string, string> | null = null;
let airlineCount = 0;

function buildIndex(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(ASSET_ROOT, "airlines.json"), "utf8");
    const airlines = JSON.parse(raw) as VendoredAirline[];
    airlineCount = airlines.length;
    for (const airline of airlines) {
      for (const code of [airline.iata, airline.icao]) {
        if (!code) continue;
        map.set(code.toUpperCase(), airline.slug);
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
 * Resolve a logo from the vendored snapshot, or null when the snapshot holds
 * neither the airline nor that variant of it.
 */
export function getVendoredLogo(code: string, variant: LogoVariant): CachedLogo | null {
  const file = VARIANT_FILES[variant];
  if (!file) return null; // wordmark-shaped variants belong to kiwi now

  const slug = getIndex().get(code.trim().toUpperCase());
  if (!slug) return null;

  // The slug comes from our own snapshot, never from the caller, so it cannot
  // carry a traversal — but resolve and re-check anyway: this function's only
  // argument is user input, and a future refactor that indexes by a caller-
  // supplied value must not turn into an arbitrary file read.
  const resolved = path.resolve(ASSET_DIR, slug, file);
  if (!resolved.startsWith(path.resolve(ASSET_DIR) + path.sep)) return null;

  try {
    const body = fs.readFileSync(resolved);
    return { body, contentType: "image/svg+xml" };
  } catch {
    // The variant is genuinely absent for this airline (only 22 of 93 ship a
    // monochrome mark). A miss, not an error.
    return null;
  }
}
