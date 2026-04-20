/**
 * Land-mask grid — fixed-resolution equirectangular bit-grid covering
 * the whole globe. Used by the A* sea-router to ask "is this cell
 * water?" in O(1).
 *
 * Layout:
 *  - `COLS = 3600` columns (longitude, -180° … +180°, step 0.1°)
 *  - `ROWS = 1800` rows (latitude, -90° … +90°, step 0.1°)
 *  - Row 0 is the southernmost (-90°..-89.9°), row 1799 the northernmost.
 *  - Column 0 is (-180°..-179.9°), column 3599 is (+179.9°..+180°).
 *  - Each cell is a single bit. `1` = land, `0` = water.
 *
 * Binary file format: raw packed bits, `ceil(COLS*ROWS / 8)` bytes.
 * Octet order within each byte: bit 7 (MSB) is the lower linear index.
 * Linear index = row * COLS + col.
 *
 * Total size: 3600 * 1800 / 8 = 810 000 bytes (about 810 KB).
 *
 * This file is pure — no I/O, no logger imports — so it can be used
 * both from the backend service at request time and from the
 * rasterizer script at build time.
 */

export const MASK_COLS = 3600;
export const MASK_ROWS = 1800;
export const MASK_CELL_DEG = 360 / MASK_COLS; // == 180 / MASK_ROWS == 0.1
export const MASK_TOTAL_CELLS = MASK_COLS * MASK_ROWS;
export const MASK_BYTES = Math.ceil(MASK_TOTAL_CELLS / 8);

/** Clamp a longitude/latitude degree into the valid grid range. */
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

export function lonToCol(lon: number): number {
  const l = clampLon(lon);
  return Math.min(MASK_COLS - 1, Math.max(0, Math.floor((l + 180) / MASK_CELL_DEG)));
}

export function latToRow(lat: number): number {
  const l = clampLat(lat);
  return Math.min(MASK_ROWS - 1, Math.max(0, Math.floor((l + 90) / MASK_CELL_DEG)));
}

export function cellIndex(row: number, col: number): number {
  return row * MASK_COLS + col;
}

export function rowFromIndex(index: number): number {
  return Math.floor(index / MASK_COLS);
}

export function colFromIndex(index: number): number {
  return index - Math.floor(index / MASK_COLS) * MASK_COLS;
}

/** Centre coordinate of a grid cell (lat, lon in degrees). */
export function cellCenter(row: number, col: number): { lat: number; lon: number } {
  const lat = -90 + (row + 0.5) * MASK_CELL_DEG;
  const lon = -180 + (col + 0.5) * MASK_CELL_DEG;
  return { lat, lon };
}

/**
 * Pack / unpack a single bit. Bit 7 (MSB) corresponds to the lower
 * linear index within a byte — documented so the rasterizer script
 * and the reader agree on byte order.
 */
export function getBit(bytes: Uint8Array, index: number): 0 | 1 {
  const byte = bytes[index >> 3];
  const bit = (byte >> (7 - (index & 7))) & 1;
  return bit === 1 ? 1 : 0;
}

export function setBit(bytes: Uint8Array, index: number, value: 0 | 1): void {
  const byteIndex = index >> 3;
  const bitMask = 1 << (7 - (index & 7));
  if (value === 1) {
    bytes[byteIndex] |= bitMask;
  } else {
    bytes[byteIndex] &= ~bitMask & 0xff;
  }
}
