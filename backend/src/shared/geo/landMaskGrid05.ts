/**
 * 0.05°-resolution land-mask grid — same layout as `landMaskGrid.ts`
 * but 4× the cell density (7200 × 3600 = ~25.9 M cells, ~3.24 MB binary).
 *
 * Why a second module instead of a parameterized factory?
 *  - The 0.1° grid is on a hot path (A* inner loop) where the JIT
 *    loves module-level constants.
 *  - Each raster has its own file on disk + its own generator; a tiny
 *    bit of code duplication is cheaper than a refactor that touches
 *    every existing caller.
 *
 * Binary file format: raw packed bits, `ceil(COLS*ROWS / 8)` bytes.
 * Bit 7 (MSB) = lower linear index within a byte. `1` = land, `0` =
 * water. Linear index = row * COLS + col. Row 0 is the southernmost
 * (-90°..-89.95°); column 0 is (-180°..-179.95°).
 */

export const MASK05_COLS = 7200;
export const MASK05_ROWS = 3600;
export const MASK05_CELL_DEG = 360 / MASK05_COLS; // == 180 / MASK05_ROWS == 0.05
export const MASK05_TOTAL_CELLS = MASK05_COLS * MASK05_ROWS;
export const MASK05_BYTES = Math.ceil(MASK05_TOTAL_CELLS / 8);

function clampLon(lon: number): number {
  if (lon <= -180) return -180 + 1e-9;
  if (lon >= 180) return 180 - 1e-9;
  return lon;
}
function clampLat(lat: number): number {
  if (lat <= -90) return -90 + 1e-9;
  if (lat >= 90) return 90 - 1e-9;
  return lat;
}

export function lonToCol05(lon: number): number {
  const l = clampLon(lon);
  return Math.min(MASK05_COLS - 1, Math.max(0, Math.floor((l + 180) / MASK05_CELL_DEG)));
}

export function latToRow05(lat: number): number {
  const l = clampLat(lat);
  return Math.min(MASK05_ROWS - 1, Math.max(0, Math.floor((l + 90) / MASK05_CELL_DEG)));
}

export function cellIndex05(row: number, col: number): number {
  return row * MASK05_COLS + col;
}

export function rowFromIndex05(index: number): number {
  return Math.floor(index / MASK05_COLS);
}

export function colFromIndex05(index: number): number {
  return index - Math.floor(index / MASK05_COLS) * MASK05_COLS;
}

export function cellCenter05(row: number, col: number): { lat: number; lon: number } {
  const lat = -90 + (row + 0.5) * MASK05_CELL_DEG;
  const lon = -180 + (col + 0.5) * MASK05_CELL_DEG;
  return { lat, lon };
}

export function getBit05(bytes: Uint8Array, index: number): 0 | 1 {
  const byte = bytes[index >> 3];
  const bit = (byte >> (7 - (index & 7))) & 1;
  return bit === 1 ? 1 : 0;
}
