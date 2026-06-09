/**
 * generate-land-mask.ts — one-off rasterizer that downloads Natural
 * Earth's 10 m land polygon GeoJSON and bakes it into the packed
 * bit-grid at `backend/data/land-mask.bin`.
 *
 * Resolution: 0.025° per cell, 14400 × 7200 grid (103.7 M cells, ~13 MB).
 *
 * Run:
 *   cd backend && npx tsx scripts/generate-land-mask.ts
 *
 * Idempotent: downloads again only if the GeoJSON temp file is
 * missing. The output file is overwritten on each run. Safe to
 * re-run when we ever upgrade to a newer Natural Earth release.
 *
 * Source:
 *   https://github.com/nvkelso/natural-earth-vector
 *   geojson/ne_10m_land.geojson  (public domain, ~10 MB)
 *
 * Algorithm:
 *   1. Fetch GeoJSON (cached in backend/data/.cache/ne_10m_land.geojson).
 *   2. For each polygon ring, run a scanline fill across the grid —
 *      for every row whose latitude falls inside the ring's lat-bbox,
 *      collect the column x-crossings with its edges and fill the
 *      alternating segments. Holes are painted as water to subtract
 *      them out again. This is the classic non-zero-even-odd fill
 *      rule and works directly on lon/lat without reprojection
 *      because the grid is equirectangular by definition.
 *   3. Write the packed-bit file.
 *
 * Why not shapefile directly: the shapefile npm package is transitively
 * available but its stream API is awkward and multi-polygon handling
 * is fiddlier. GeoJSON keeps the rasterizer readable and the file is
 * a one-time ~10 MB download.
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  MASK_BYTES,
  MASK_CELL_DEG,
  MASK_COLS,
  MASK_ROWS,
  cellIndex,
  getBit,
  setBit,
} from '../src/shared/geo/landMaskGrid';

const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson';

const OUT_PATH = path.resolve(__dirname, '..', 'data', 'land-mask.bin');
const CACHE_DIR = path.resolve(__dirname, '..', 'data', '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'ne_10m_land.geojson');

type Ring = [number, number][]; // [lon, lat]

interface PolygonGeom {
  type: 'Polygon';
  coordinates: Ring[];
}
interface MultiPolygonGeom {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}
type Geom = PolygonGeom | MultiPolygonGeom;

interface Feature {
  type: 'Feature';
  geometry: Geom;
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

async function downloadGeoJSON(): Promise<FeatureCollection> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    const cached = await fs.readFile(CACHE_PATH, 'utf8');
    process.stdout.write(`[land-mask] Using cached GeoJSON at ${CACHE_PATH}\n`);
    return JSON.parse(cached) as FeatureCollection;
  } catch {
    // fall through to network fetch
  }

  process.stdout.write(`[land-mask] Downloading ${NE_URL}\n`);
  const res = await fetch(NE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Natural Earth 10 m land: HTTP ${res.status}`);
  }
  const body = await res.text();
  await fs.writeFile(CACHE_PATH, body);
  process.stdout.write(`[land-mask] Cached ${body.length} bytes to ${CACHE_PATH}\n`);
  return JSON.parse(body) as FeatureCollection;
}

/**
 * Rasterize one ring (outer or hole) into the given bit-grid at the
 * given value (1 = land, 0 = water — used to punch holes).
 *
 * Uses even-odd scanline fill. For each grid-row whose latitude
 * falls inside the ring's y-bbox, we collect the x-intersections
 * with each ring edge, sort them, and paint the cells between every
 * consecutive pair. This is exactly the half-open interval rule that
 * the OpenGL rasterizer uses and avoids seam artefacts on shared
 * edges between adjacent polygons (Antarctica's ring chains).
 */
function rasterizeRing(bytes: Uint8Array, ring: Ring, value: 0 | 1): void {
  if (ring.length < 3) return;

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  // Scan every row whose centre-latitude falls within [minLat, maxLat].
  const rowStart = Math.max(0, Math.floor((minLat + 90) / MASK_CELL_DEG));
  const rowEnd = Math.min(MASK_ROWS - 1, Math.floor((maxLat + 90) / MASK_CELL_DEG));

  const edges: { y0: number; y1: number; x0: number; x1: number }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    if (y0 === y1) continue; // horizontal edges contribute nothing
    edges.push({ y0, y1, x0, x1 });
  }

  for (let row = rowStart; row <= rowEnd; row++) {
    const y = -90 + (row + 0.5) * MASK_CELL_DEG;

    // Collect longitudes where this latitude crosses an edge.
    const crossings: number[] = [];
    for (const e of edges) {
      const yMin = Math.min(e.y0, e.y1);
      const yMax = Math.max(e.y0, e.y1);
      // Use the half-open rule [yMin, yMax) to avoid counting a vertex twice
      // when two edges share it.
      if (y < yMin || y >= yMax) continue;
      const t = (y - e.y0) / (e.y1 - e.y0);
      const x = e.x0 + t * (e.x1 - e.x0);
      crossings.push(x);
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);

    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const xStart = crossings[k];
      const xEnd = crossings[k + 1];
      const colStart = Math.max(0, Math.floor((xStart + 180) / MASK_CELL_DEG));
      const colEnd = Math.min(MASK_COLS - 1, Math.floor((xEnd + 180) / MASK_CELL_DEG));
      for (let col = colStart; col <= colEnd; col++) {
        setBit(bytes, cellIndex(row, col), value);
      }
    }
  }
}

function rasterize(fc: FeatureCollection): Uint8Array {
  const bytes = new Uint8Array(MASK_BYTES);

  let polygonCount = 0;
  let holeCount = 0;

  for (const feature of fc.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      const rings = geom.coordinates;
      if (rings.length === 0) continue;
      rasterizeRing(bytes, rings[0], 1);
      polygonCount++;
      for (let i = 1; i < rings.length; i++) {
        rasterizeRing(bytes, rings[i], 0);
        holeCount++;
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly.length === 0) continue;
        rasterizeRing(bytes, poly[0], 1);
        polygonCount++;
        for (let i = 1; i < poly.length; i++) {
          rasterizeRing(bytes, poly[i], 0);
          holeCount++;
        }
      }
    }
  }

  process.stdout.write(
    `[land-mask] Rasterized ${polygonCount} polygons (${holeCount} holes)\n`,
  );
  return bytes;
}

async function main(): Promise<void> {
  const start = Date.now();
  const fc = await downloadGeoJSON();
  process.stdout.write(`[land-mask] Loaded ${fc.features.length} features\n`);

  const bytes = rasterize(fc);

  let landCells = 0;
  for (let i = 0; i < MASK_COLS * MASK_ROWS; i++) {
    if (getBit(bytes, i) === 1) landCells++;
  }
  const waterCells = MASK_COLS * MASK_ROWS - landCells;
  process.stdout.write(
    `[land-mask] Grid stats: total=${MASK_COLS * MASK_ROWS}  land=${landCells}  water=${waterCells}\n`,
  );

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, bytes);
  process.stdout.write(`[land-mask] Wrote ${bytes.byteLength} bytes to ${OUT_PATH}\n`);
  process.stdout.write(`[land-mask] Done in ${Math.round((Date.now() - start) / 1000)} s\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[land-mask] FAILED: ${msg}\n`);
  process.exit(1);
});
