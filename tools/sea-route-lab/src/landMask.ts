import type { LonLat } from "./types";

/**
 * Packed land mask. Same format the TravStats backend uses but loaded
 * browser-side from `/land-mask-<cellDeg>deg.bin`. Layout: big bitmap
 * row-major, north-to-south, col wraps at antimeridian, bit 1 = land.
 */
export interface LandMask {
  bytes: Uint8Array;
  rows: number;
  cols: number;
  cellDeg: number;
}

const LOADED = new Map<number, Promise<LandMask>>();

/**
 * Lazy-load + cache a land mask. Multiple methods share the same
 * buffer, so repeated calls are cheap. Raster shape is inferred from
 * `cellDeg`: the whole globe is 180° lat × 360° lon.
 */
export function loadLandMask(cellDeg: number): Promise<LandMask> {
  const existing = LOADED.get(cellDeg);
  if (existing) return existing;
  const rows = Math.round(180 / cellDeg);
  const cols = Math.round(360 / cellDeg);
  const expectedBytes = Math.ceil((rows * cols) / 8);
  const promise = fetch(`/land-mask-${cellDeg}deg.bin`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`land-mask-${cellDeg}deg.bin: ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== expectedBytes) {
        throw new Error(
          `land-mask-${cellDeg}deg.bin: ${buf.byteLength} bytes, expected ${expectedBytes}`,
        );
      }
      return { bytes: new Uint8Array(buf), rows, cols, cellDeg };
    })
    .catch((err) => {
      LOADED.delete(cellDeg);
      throw err;
    });
  LOADED.set(cellDeg, promise);
  return promise;
}

export function latToRow(lat: number, mask: LandMask): number {
  const row = Math.floor((90 - lat) / mask.cellDeg);
  return Math.max(0, Math.min(mask.rows - 1, row));
}

export function lonToCol(lon: number, mask: LandMask): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360;
  const col = Math.floor(wrapped / mask.cellDeg);
  return col % mask.cols;
}

export function cellIndex(row: number, col: number, mask: LandMask): number {
  return row * mask.cols + col;
}

export function cellCenter(row: number, col: number, mask: LandMask): LonLat {
  const lat = 90 - (row + 0.5) * mask.cellDeg;
  let lon = (col + 0.5) * mask.cellDeg - 180;
  if (lon > 180) lon -= 360;
  return [lon, lat];
}

export function isWaterCell(row: number, col: number, mask: LandMask): boolean {
  const idx = cellIndex(row, col, mask);
  const byte = mask.bytes[idx >> 3];
  const bit = (byte >> (7 - (idx & 7))) & 1;
  return bit === 0;
}
