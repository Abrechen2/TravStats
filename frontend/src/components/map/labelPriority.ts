// Priority-based label reveal for the flat map.
//
// The old behaviour hid ALL marker labels below a hard zoom threshold, so
// zooming out wiped even the big, frequently-visited airports/ports. Instead
// we keep a zoom-dependent BUDGET of labels and always spend it on the
// highest-weight markers (visit count / size). Zooming in grows the budget so
// smaller markers reveal progressively.
//
// `pickLabelled` alone only counts candidates — it has no idea where two
// labels land on screen. That's fine at world scale (busy hubs tend to be
// far apart), but a dense regional cluster of busy markers (e.g. the
// MUC/FRA/VIE/ZRH/CDG hubs in central Europe) can all be "in budget"
// simultaneously and still stack their labels on top of each other.
// `declutterByDistance` adds real screen-space spacing on top of the
// budget — see its own doc comment (#label-overlap).

export type LabelsMode = "off" | "important" | "all";

// How many labels may show at a given (rounded) zoom in "important" mode.
// Tuned so a world view shows a handful of hubs and each zoom step roughly
// doubles the count until effectively everything is labelled.
export function labelBudget(zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 0;
  if (z <= 1) return 5;
  return Math.round(5 * Math.pow(1.9, Math.max(0, z - 1)));
}

// Return the subset of `items` that should be labelled for the given mode +
// zoom, highest-weight first. "all" labels everything, "off" labels nothing,
// "important" spends the zoom budget on the heaviest markers.
export function pickLabelled<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  mode: LabelsMode,
  zoom: number
): T[] {
  if (mode === "off") return [];
  if (mode === "all") return [...items];
  const budget = labelBudget(zoom);
  if (items.length <= budget) return [...items];
  return [...items].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, budget);
}

// Web Mercator meters-per-pixel at a given latitude/zoom, tile size 256px —
// the standard formula (see e.g. the OSM/Mapbox wiki "Zoom levels" page).
// An approximation (assumes a spherical Earth, ignores map tilt/pitch), more
// than accurate enough for a "are these two labels visually too close"
// pixel-distance check.
const EARTH_CIRCUMFERENCE_M = 40075016.686;

function metersPerPixel(latDeg: number, zoom: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / (256 * Math.pow(2, zoom));
}

// Great-circle distance in meters (haversine).
function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Greedily keep only the labels that are at least `minPixelGap` screen
 * pixels apart at the given zoom, highest-weight first — a real spatial
 * declutter pass to layer on top of `pickLabelled`'s zoom-based count
 * budget. Two markers can both be "in budget" and still sit a few screen
 * pixels apart (a dense regional cluster of busy airports/ports); this is
 * the only place in the label pipeline that actually measures distance
 * between candidates (#label-overlap).
 *
 * `positionOf` returns `[lon, lat]` (matches deck.gl's position convention).
 * `minPixelGap` defaults to a bit wider than a typical rendered label pill
 * (~30-40px) so two adjacent labels get visible breathing room, not just a
 * bare non-overlap.
 */
export function declutterByDistance<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  positionOf: (item: T) => readonly [number, number],
  zoom: number,
  minPixelGap = 42
): T[] {
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const accepted: T[] = [];
  const acceptedPositions: [number, number][] = [];
  for (const item of sorted) {
    const [lon, lat] = positionOf(item);
    const mpp = metersPerPixel(lat, zoom);
    const tooClose = acceptedPositions.some(([aLon, aLat]) => {
      const meters = haversineMeters(lat, lon, aLat, aLon);
      return meters / mpp < minPixelGap;
    });
    if (!tooClose) {
      accepted.push(item);
      acceptedPositions.push([lon, lat]);
    }
  }
  return accepted;
}

/** A label's estimated box on screen, in CSS pixels. */
export interface LabelBoxSize {
  width: number;
  height: number;
}

/**
 * The box a TextLayer pill of `text` occupies: glyph advance from the font
 * size (Inter bold averages about 0.62 em), plus the pill's padding and
 * border. An estimate — the atlas is not measured — erring wide, because a
 * label dropped for a few pixels costs less than two printed over each other.
 */
export function estimateLabelBox(
  text: string,
  fontSizePx: number,
  padding: readonly [number, number]
): LabelBoxSize {
  return {
    width: text.length * fontSizePx * 0.62 + padding[0] * 2 + 2,
    height: fontSizePx * 1.2 + padding[1] * 2 + 2,
  };
}

/** MapLibre's world is 512 px wide at zoom 0. */
const WORLD_PX_AT_Z0 = 512;
const MAX_MERCATOR_LAT = 85.051129;

/** Web Mercator world pixel of a `[lon, lat]` at `zoom`. */
export function projectToWorldPx(lon: number, lat: number, zoom: number): [number, number] {
  const size = WORLD_PX_AT_Z0 * Math.pow(2, zoom);
  const phi = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180;
  const x = ((lon + 180) / 360) * size;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * size;
  return [x, y];
}

const GRID_CELL_PX = 128;

/**
 * A label already on the map, as another layer's collision pass needs it:
 * where it is anchored, its box, and how far its pill is lifted off the point
 * (`getPixelOffset[1]`). The airport, port, hotel and place labels each lift
 * by a different amount, so the offset no longer cancels once they meet.
 */
export interface PlacedLabel {
  position: readonly [number, number];
  width: number;
  height: number;
  offsetY: number;
}

export interface BoxDeclutterOptions {
  /** Space kept free on every side of a box, in px. */
  gapPx?: number;
  /** How far these items' pills are lifted off their point, in px (negative = up). */
  offsetY?: number;
  /** Labels already placed by other layers; an item touching one is dropped. */
  obstacles?: readonly PlacedLabel[];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The screen box of a pill centred `offsetY` px off its point — deck.gl's
 *  default text anchor and baseline are both centred. */
function boxAt(
  position: readonly [number, number],
  width: number,
  height: number,
  offsetY: number,
  zoom: number,
  gapPx: number
): Box {
  const [x, y] = projectToWorldPx(position[0], position[1], zoom);
  const cy = y + offsetY;
  return {
    x0: x - width / 2 - gapPx,
    x1: x + width / 2 + gapPx,
    y0: cy - height / 2 - gapPx,
    y1: cy + height / 2 + gapPx,
  };
}

/**
 * Like `declutterByDistance`, but on the labels' BOXES: a centre gap says
 * nothing about two 20-character names, which are 140 px wide and collide
 * with their centres 80 px apart. Highest weight places first; a label whose
 * box (plus `gapPx` on every side) touches one already placed — or one of the
 * `obstacles` another layer already shows — is dropped.
 *
 * Placed boxes live in a uniform grid, so each candidate only tests the boxes
 * in the cells it covers — linear in the number of labels, not quadratic.
 */
export function declutterByBoxes<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  positionOf: (item: T) => readonly [number, number],
  sizeOf: (item: T) => LabelBoxSize,
  zoom: number,
  { gapPx = 4, offsetY = 0, obstacles = [] }: BoxDeclutterOptions = {}
): T[] {
  const grid = new Map<string, Box[]>();
  const cellsOf = (box: Box): string[] => {
    const keys: string[] = [];
    for (
      let cx = Math.floor(box.x0 / GRID_CELL_PX);
      cx <= Math.floor(box.x1 / GRID_CELL_PX);
      cx++
    ) {
      for (
        let cy = Math.floor(box.y0 / GRID_CELL_PX);
        cy <= Math.floor(box.y1 / GRID_CELL_PX);
        cy++
      ) {
        keys.push(`${cx}:${cy}`);
      }
    }
    return keys;
  };
  const place = (box: Box) => {
    for (const key of cellsOf(box)) {
      const cell = grid.get(key);
      if (cell) cell.push(box);
      else grid.set(key, [box]);
    }
  };
  // Obstacles carry no gap of their own: the candidate's gap already keeps
  // the two apart.
  for (const o of obstacles) place(boxAt(o.position, o.width, o.height, o.offsetY, zoom, 0));
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const accepted: T[] = [];
  for (const item of sorted) {
    const { width, height } = sizeOf(item);
    const box = boxAt(positionOf(item), width, height, offsetY, zoom, gapPx);
    const hit = cellsOf(box).some((key) =>
      (grid.get(key) ?? []).some(
        (q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0
      )
    );
    if (hit) continue;
    accepted.push(item);
    place(box);
  }
  return accepted;
}
