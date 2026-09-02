#!/usr/bin/env node
/**
 * Regenerates `countries-10m.geojson` from Natural Earth.
 *
 * SOURCE
 *   Natural Earth, Admin 0 – Countries, 1:10m cultural vectors, taken from the
 *   nvkelso/natural-earth-vector mirror (the same GeoJSON build the upstream
 *   naciscdn shapefiles produce, but without a shapefile toolchain):
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
 *
 * LICENCE
 *   Public domain. Natural Earth's terms: "All versions of Natural Earth raster
 *   and vector map data found on this website are in the public domain. You may
 *   use the maps in any manner, including modifying the content and design,
 *   electronic dissemination, and offset printing. […] Crediting the authors is
 *   unnecessary." There is therefore no attribution obligation to carry, which
 *   is why this file is the whole provenance record.
 *
 * WHY 1:10m AND NOT THE MUCH SMALLER 1:110m OR 1:50m
 *   Measured on 2026-09-02 with the probe coordinates that
 *   `__tests__/countryFromCoordinates.test.ts` now pins:
 *
 *     1:110m   175 ISO codes,  0.8 MB. Has no polygon at all for Liechtenstein,
 *              Monaco, San Marino, Vatican City, Andorra, Malta, Singapore,
 *              Bahrain, Maldives and 17 more.
 *     1:50m    237 ISO codes,  1.9 MB. Carries the microstates but cannot
 *              RESOLVE them: St Peter's Square comes back IT, Monaco and Hong
 *              Kong and Macau come back null, Gibraltar is absent entirely, and
 *              Malbun — a Liechtenstein ski village — comes back AT.
 *     1:10m    239 ISO codes, 10.2 MB. Every one of those resolves correctly.
 *
 *   The 1:50m failure is the worse kind: a country silently answered as its
 *   larger neighbour is a wrong country in somebody's passport, not a gap. Spec
 *   §8.3 forbids exactly that ("do not let a microstate silently never appear"),
 *   so the 8 MB buys the honesty rather than a nicety. For scale, the vendored
 *   land mask beside this directory is already 13 MB.
 *
 *   Douglas-Peucker simplification was measured too (adaptive tolerance, ring
 *   diagonal / 400 capped at 0.05°): 3.2 MB, all probes still correct, but
 *   0.26 % of random land points disagreed with the unsimplified source. It was
 *   REJECTED because the only thing it bought was lookup speed, and the
 *   latitude-band edge index in `countryBoundaries.ts` buys that exactly,
 *   without inventing a tolerance nobody can defend.
 *
 * WHAT THIS SCRIPT CHANGES ABOUT THE SOURCE
 *   1. Drops all ~170 Natural Earth attribute columns except one ISO code. That
 *      alone is most of the size: the raw file is 13.3 MB.
 *   2. Rounds coordinates to 4 decimal places (~11 m). The 1:10m outlines are
 *      themselves several hundred metres from truth, so this is below the
 *      dataset's own error. 3 decimals was measured too — zero disagreements
 *      over 200 000 sample points, but only 1 MB smaller, so it was not worth
 *      moving further from the source.
 *   3. Drops features with no usable ISO 3166-1 alpha-2 code. Those are the
 *      unattributed and disputed areas — Somaliland, Northern Cyprus, the UN
 *      Buffer Zone in Cyprus, Bir Tawil, Siachen Glacier, Guantanamo Bay, the
 *      Southern Patagonian Ice Field, Wake Island and five more. A point there
 *      must resolve to null; assigning it to whoever claims it would be the
 *      invented value this whole design exists to remove.
 *
 * VALIDATING THE CODE
 *   Natural Earth writes "-99" where it has no ISO code, and its `POSTAL` /
 *   `WB_A2` columns hold things like "AK" and "DH" that LOOK like ISO codes and
 *   are not. Those two columns are therefore never consulted. `ISO_A2_EH` is
 *   preferred over `ISO_A2` because it is the column where Natural Earth
 *   repaired its own "-99" entries — without it France and Norway have no code.
 *   Each surviving candidate is then checked against `Intl.DisplayNames`, which
 *   echoes an unknown region back unchanged; a code that does not name a region
 *   is dropped. That is a real membership test with no second list to maintain.
 *
 * USAGE
 *   node backend/data/countries/build-country-boundaries.mjs
 *   node backend/data/countries/build-country-boundaries.mjs --from /tmp/ne.geojson
 */

import { createWriteStream } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(OUT_DIR, "countries-10m.geojson");
const DECIMALS = 4;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** A candidate is an ISO 3166-1 alpha-2 code only if it actually names a region. */
function isRealCountryCode(candidate) {
  if (typeof candidate !== "string" || !/^[A-Z]{2}$/.test(candidate)) return false;
  try {
    const name = regionNames.of(candidate);
    return Boolean(name) && name !== candidate;
  } catch {
    return false;
  }
}

function isoCodeOf(properties) {
  for (const column of [properties.ISO_A2_EH, properties.ISO_A2]) {
    if (isRealCountryCode(column)) return column;
  }
  return null;
}

const factor = 10 ** DECIMALS;
const roundRing = (ring) =>
  ring.map(([lon, lat]) => [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor]);

function roundGeometry(geometry) {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(roundRing) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => polygon.map(roundRing)),
    };
  }
  return null;
}

async function readSource() {
  const flag = process.argv.indexOf("--from");
  if (flag !== -1 && process.argv[flag + 1]) {
    return JSON.parse(await readFile(process.argv[flag + 1], "utf-8"));
  }
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL} -> HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const source = await readSource();
  const kept = [];
  const dropped = [];

  for (const feature of source.features) {
    const iso = isoCodeOf(feature.properties ?? {});
    const geometry = feature.geometry ? roundGeometry(feature.geometry) : null;
    if (!iso || !geometry) {
      dropped.push(feature.properties?.NAME_EN ?? feature.properties?.NAME ?? "(unnamed)");
      continue;
    }
    kept.push({ type: "Feature", properties: { iso }, geometry });
  }

  // Sorted by code so a regeneration produces a byte-identical file for
  // identical input — a 10 MB blob whose diff is line noise is a blob nobody
  // can review.
  kept.sort((a, b) => a.properties.iso.localeCompare(b.properties.iso));

  // Streamed one feature per line rather than a single JSON.stringify: the
  // whole document as one string is over Node's comfortable string budget on
  // small containers, and per-line features make `git diff` readable.
  const out = createWriteStream(`${OUT_PATH}.tmp`, "utf-8");
  const write = (chunk) =>
    out.write(chunk) ? Promise.resolve() : new Promise((r) => out.once("drain", r));

  await write('{\n"type":"FeatureCollection",\n');
  await write(`"source":${JSON.stringify(SOURCE_URL)},\n`);
  await write('"license":"Public domain (Natural Earth) - no attribution required",\n');
  await write('"resolution":"1:10m",\n');
  await write(
    '"generatedBy":"backend/data/countries/build-country-boundaries.mjs - see that file for why 1:10m",\n'
  );
  await write('"features":[\n');
  for (let i = 0; i < kept.length; i++) {
    await write(JSON.stringify(kept[i]) + (i === kept.length - 1 ? "\n" : ",\n"));
  }
  await write("]}\n");
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  await rename(`${OUT_PATH}.tmp`, OUT_PATH);

  const codes = new Set(kept.map((f) => f.properties.iso));
  process.stdout.write(
    `wrote ${OUT_PATH}\n  features: ${kept.length}\n  ISO codes: ${codes.size}\n` +
      `  dropped (no ISO 3166-1 alpha-2): ${dropped.length} -> ${dropped.join(", ")}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
