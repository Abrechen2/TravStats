/**
 * Parametric land-mask generator. Unlike the backend's version, cell
 * resolution is a CLI argument — use this to bake the 0.05° variant
 * the sea-route lab needs for its A* finer-raster method.
 *
 * Run:
 *   cd tools/sea-route-lab && npx tsx scripts/generate-mask.ts --res 0.05
 *
 * Writes to ../../backend/data/land-mask-<res>deg.bin (so the Vite
 * middleware in vite.config.ts picks it up without a copy). The
 * Natural Earth 10m land GeoJSON is re-used from the backend's cache
 * so nothing gets re-downloaded.
 *
 * Not wired into any CI — this is one-off baking when we want a new
 * resolution. Output size scales as 1/cellDeg²:
 *   0.1°   → 810 000 B   (~810 KB, current backend)
 *   0.05°  → 3 240 000 B (~3.1 MB)
 *   0.02°  → 20 250 000 B (~19 MB, impractical for browser)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";

// Re-use the backend's cache dir so we don't re-download the 10 MB
// GeoJSON every time the lab needs a new resolution.
const CACHE_DIR = path.resolve(__dirname, "..", "..", "..", "backend", "data", ".cache");
const CACHE_PATH = path.join(CACHE_DIR, "ne_10m_land.geojson");
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "backend", "data");

type Ring = [number, number][];
interface PolygonGeom {
  type: "Polygon";
  coordinates: Ring[];
}
interface MultiPolygonGeom {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
type Geom = PolygonGeom | MultiPolygonGeom;
interface Feature {
  type: "Feature";
  geometry: Geom;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

interface GridConfig {
  cellDeg: number;
  rows: number;
  cols: number;
  totalCells: number;
  byteCount: number;
  outPath: string;
}

function gridFor(cellDeg: number): GridConfig {
  if (cellDeg <= 0 || cellDeg > 1) {
    throw new Error(`cellDeg must be in (0, 1], got ${cellDeg}`);
  }
  const rows = Math.round(180 / cellDeg);
  const cols = Math.round(360 / cellDeg);
  const totalCells = rows * cols;
  return {
    cellDeg,
    rows,
    cols,
    totalCells,
    byteCount: Math.ceil(totalCells / 8),
    outPath: path.resolve(OUT_DIR, `land-mask-${cellDeg}deg.bin`),
  };
}

function setBit(bytes: Uint8Array, idx: number, value: 0 | 1): void {
  const byteIdx = idx >> 3;
  const bitIdx = 7 - (idx & 7);
  if (value === 1) bytes[byteIdx] |= 1 << bitIdx;
  else bytes[byteIdx] &= ~(1 << bitIdx);
}
function getBit(bytes: Uint8Array, idx: number): 0 | 1 {
  return ((bytes[idx >> 3] >> (7 - (idx & 7))) & 1) as 0 | 1;
}
function cellIndex(row: number, col: number, cfg: GridConfig): number {
  return row * cfg.cols + col;
}

async function downloadGeoJSON(): Promise<FeatureCollection> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    const cached = await fs.readFile(CACHE_PATH, "utf8");
    process.stdout.write(`[mask-gen] Using cached GeoJSON at ${CACHE_PATH}\n`);
    return JSON.parse(cached) as FeatureCollection;
  } catch {
    // fall through
  }
  process.stdout.write(`[mask-gen] Downloading ${NE_URL}\n`);
  const res = await fetch(NE_URL);
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const body = await res.text();
  await fs.writeFile(CACHE_PATH, body);
  process.stdout.write(`[mask-gen] Cached ${body.length} bytes\n`);
  return JSON.parse(body) as FeatureCollection;
}

function rasterizeRing(bytes: Uint8Array, ring: Ring, value: 0 | 1, cfg: GridConfig): void {
  if (ring.length < 3) return;

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const rowStart = Math.max(0, Math.floor((minLat + 90) / cfg.cellDeg));
  const rowEnd = Math.min(cfg.rows - 1, Math.floor((maxLat + 90) / cfg.cellDeg));

  const edges: { y0: number; y1: number; x0: number; x1: number }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    if (y0 === y1) continue;
    edges.push({ y0, y1, x0, x1 });
  }

  for (let row = rowStart; row <= rowEnd; row++) {
    const y = -90 + (row + 0.5) * cfg.cellDeg;
    const crossings: number[] = [];
    for (const e of edges) {
      const yMin = Math.min(e.y0, e.y1);
      const yMax = Math.max(e.y0, e.y1);
      if (y < yMin || y >= yMax) continue;
      const t = (y - e.y0) / (e.y1 - e.y0);
      crossings.push(e.x0 + t * (e.x1 - e.x0));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const colStart = Math.max(0, Math.floor((crossings[k] + 180) / cfg.cellDeg));
      const colEnd = Math.min(cfg.cols - 1, Math.floor((crossings[k + 1] + 180) / cfg.cellDeg));
      for (let col = colStart; col <= colEnd; col++) {
        setBit(bytes, cellIndex(row, col, cfg), value);
      }
    }
  }
}

function rasterize(fc: FeatureCollection, cfg: GridConfig): Uint8Array {
  const bytes = new Uint8Array(cfg.byteCount);
  let polygonCount = 0;
  let holeCount = 0;
  for (const feature of fc.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      const rings = geom.coordinates;
      if (rings.length === 0) continue;
      rasterizeRing(bytes, rings[0], 1, cfg);
      polygonCount++;
      for (let i = 1; i < rings.length; i++) {
        rasterizeRing(bytes, rings[i], 0, cfg);
        holeCount++;
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (poly.length === 0) continue;
        rasterizeRing(bytes, poly[0], 1, cfg);
        polygonCount++;
        for (let i = 1; i < poly.length; i++) {
          rasterizeRing(bytes, poly[i], 0, cfg);
          holeCount++;
        }
      }
    }
  }
  process.stdout.write(`[mask-gen] Rasterized ${polygonCount} polygons (${holeCount} holes)\n`);
  return bytes;
}

function parseCellDeg(): number {
  const args = process.argv.slice(2);
  const ix = args.findIndex((a) => a === "--res" || a === "-r");
  if (ix < 0 || ix === args.length - 1) {
    process.stderr.write("usage: generate-mask.ts --res <cellDeg>  (e.g. 0.05)\n");
    process.exit(1);
  }
  const v = Number(args[ix + 1]);
  if (!Number.isFinite(v)) {
    process.stderr.write(`[mask-gen] Not a number: ${args[ix + 1]}\n`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const cellDeg = parseCellDeg();
  const cfg = gridFor(cellDeg);
  process.stdout.write(
    `[mask-gen] cellDeg=${cfg.cellDeg}°  grid=${cfg.cols}×${cfg.rows}  bytes=${cfg.byteCount}\n`,
  );
  const started = Date.now();

  const fc = await downloadGeoJSON();
  process.stdout.write(`[mask-gen] Loaded ${fc.features.length} features\n`);
  const bytes = rasterize(fc, cfg);

  let landCells = 0;
  for (let i = 0; i < cfg.totalCells; i++) {
    if (getBit(bytes, i) === 1) landCells++;
  }
  process.stdout.write(
    `[mask-gen] total=${cfg.totalCells}  land=${landCells}  water=${cfg.totalCells - landCells}\n`,
  );

  await fs.mkdir(path.dirname(cfg.outPath), { recursive: true });
  await fs.writeFile(cfg.outPath, bytes);
  process.stdout.write(`[mask-gen] Wrote ${bytes.byteLength} bytes to ${cfg.outPath}\n`);
  process.stdout.write(`[mask-gen] Done in ${Math.round((Date.now() - started) / 1000)} s\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mask-gen] FAILED: ${msg}\n`);
  process.exit(1);
});
