/**
 * 1° land/water raster — the coarse grid used for schematic cruise
 * routing. At 180 × 360 = 64 800 cells it's small enough to live as
 * an 8 100-byte typed array, downsampled from the 0.1° Natural Earth
 * mask at boot time.
 *
 * Philosophy: routes computed on this grid are deliberately not
 * nautically accurate — they're symbolic curves between ports that
 * avoid continents. Detail-level artefacts (fjords, narrow straits,
 * harbour entrances) vanish at 1°, which is intentional: the frontend
 * splines the resulting waypoints into a smooth curve, so the crude
 * grid produces exactly the "illustrated cruise map" aesthetic.
 */

export const MASK1_COLS = 360;
export const MASK1_ROWS = 180;
export const MASK1_CELL_DEG = 1;
export const MASK1_TOTAL_CELLS = MASK1_COLS * MASK1_ROWS;
export const MASK1_BYTES = Math.ceil(MASK1_TOTAL_CELLS / 8);

function clampLat(lat: number): number {
  if (lat < -90) return -90;
  if (lat > 90) return 90;
  return lat;
}

function clampLon(lon: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  return l;
}

export function lonToCol1(lon: number): number {
  const l = clampLon(lon);
  return Math.min(MASK1_COLS - 1, Math.max(0, Math.floor((l + 180) / MASK1_CELL_DEG)));
}

export function latToRow1(lat: number): number {
  const l = clampLat(lat);
  return Math.min(MASK1_ROWS - 1, Math.max(0, Math.floor((l + 90) / MASK1_CELL_DEG)));
}

export function cellIndex1(row: number, col: number): number {
  return row * MASK1_COLS + col;
}

export function rowFromIndex1(index: number): number {
  return Math.floor(index / MASK1_COLS);
}

export function colFromIndex1(index: number): number {
  return index % MASK1_COLS;
}

export function cellCenter1(row: number, col: number): { lat: number; lon: number } {
  const lat = -90 + (row + 0.5) * MASK1_CELL_DEG;
  const lon = -180 + (col + 0.5) * MASK1_CELL_DEG;
  return { lat, lon };
}

export function getBit1(bytes: Uint8Array, index: number): 0 | 1 {
  const byte = bytes[index >> 3];
  const bit = (byte >> (7 - (index & 7))) & 1;
  return bit === 1 ? 1 : 0;
}

export function setBit1(bytes: Uint8Array, index: number, value: 0 | 1): void {
  const byteIndex = index >> 3;
  const bitMask = 1 << (7 - (index & 7));
  if (value === 1) {
    bytes[byteIndex] |= bitMask;
  } else {
    bytes[byteIndex] &= ~bitMask & 0xff;
  }
}
