/**
 * Where on a photo might a 2D barcode be?
 *
 * A PDF417, Aztec or QR symbol is a solid block of high-contrast texture:
 * every small cell inside it holds both ink and paper. Printed text has the
 * same contrast but leaves gaps — between lines, between words, around the
 * big route letters — so after a light closing step it forms ragged, sparse
 * shapes, while a barcode forms one dense rectangle. That is all this looks
 * for; zxing decides what the block actually is.
 *
 * Deliberately cheap (one pass for cell statistics, one flood fill) and
 * generous: a false candidate costs a few decode attempts, a missed barcode
 * costs the flight.
 */
import type { Box, Gray } from "./pixels";

/** Cells per image short side — the grid the texture is judged on. */
const CELLS_PER_SHORT_SIDE = 90;
/** A cell is "textured" when its pixels spread at least this far (std dev). */
const MIN_CELL_STDDEV = 38;
/** A candidate must span at least this many cells along its short side. */
const MIN_SIDE_CELLS = 4;
/** And fill at least this share of its bounding box with textured cells. */
const MIN_FILL = 0.5;
/**
 * Margin added on every side, as a share of the candidate's LONG side. Generous
 * on purpose: zxing needs a quiet zone, and a faded edge of the symbol (the
 * second United pass lost a third of its contrast on one side) is not
 * textured enough to be part of the block it belongs to.
 */
const MARGIN = 0.15;
export const MAX_REGIONS = 8;

export interface Region extends Box {
  /** Share of the box's cells that are textured — higher reads more like a barcode. */
  readonly fill: number;
}

export function findBarcodeRegions(g: Gray): Region[] {
  const cell = Math.max(4, Math.round(Math.min(g.width, g.height) / CELLS_PER_SHORT_SIDE));
  const cols = Math.floor(g.width / cell);
  const rows = Math.floor(g.height / cell);
  if (cols < MIN_SIDE_CELLS || rows < MIN_SIDE_CELLS) return [];

  const hot = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0;
      let sumSq = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        const base = y * g.width + cx * cell;
        for (let x = 0; x < cell; x++) {
          const v = g.data[base + x];
          sum += v;
          sumSq += v * v;
        }
      }
      const n = cell * cell;
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      hot[cy * cols + cx] = sd >= MIN_CELL_STDDEV ? 1 : 0;
    }
  }

  // Closing (dilate, then erode) by one cell: bridges the white module gaps
  // inside a symbol without merging it with text a few cells away.
  const closed = erode(dilate(hot, cols, rows), cols, rows);

  const seen = new Uint8Array(cols * rows);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || seen[start]) continue;
    let minX = cols;
    let minY = rows;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % cols;
      const y = (i - x) / cols;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const j of [i - 1, i + 1, i - cols, i + cols]) {
        if (j < 0 || j >= closed.length) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === cols - 1)) continue;
        if (closed[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = count / (bw * bh);
    if (Math.min(bw, bh) < MIN_SIDE_CELLS || fill < MIN_FILL) continue;
    const mx = Math.max(bw, bh) * cell * MARGIN;
    const my = mx;
    const x = Math.max(0, minX * cell - mx);
    const y = Math.max(0, minY * cell - my);
    regions.push({
      x,
      y,
      width: Math.min(g.width, (maxX + 1) * cell + mx) - x,
      height: Math.min(g.height, (maxY + 1) * cell + my) - y,
      fill,
    });
  }

  // Densest and largest first; a whole-image-sized "region" is the photo
  // itself and adds nothing over the full-frame attempt.
  return regions
    .filter((r) => r.width * r.height < 0.8 * g.width * g.height)
    .sort((a, b) => b.fill * b.width * b.height - a.fill * a.width * a.height)
    .slice(0, MAX_REGIONS);
}

function dilate(src: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && src[ny * cols + nx]) on = 1;
        }
      }
      out[y * cols + x] = on;
    }
  }
  return out;
}

function erode(src: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy++) {
        for (let dx = -1; dx <= 1 && on; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          // Outside the image counts as "on" so a symbol touching the edge
          // is not eaten away from that side.
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !src[ny * cols + nx]) on = 0;
        }
      }
      out[y * cols + x] = on;
    }
  }
  return out;
}
