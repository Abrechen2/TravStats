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

/** A `[lon, lat]` to screen-like pixels — the collision pass's geometry. */
export type LabelProjector = (position: readonly [number, number]) => readonly [number, number];

export interface BoxDeclutterOptions {
  /**
   * Where a point lands, in pixels. Defaults to north-up Web Mercator at
   * `zoom`; a layer that knows its viewport passes the viewport's own
   * projection, so a turned or tilted map is measured as it is drawn.
   */
  project?: LabelProjector;
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
  project: LabelProjector,
  gapPx: number
): Box {
  const [x, y] = project(position);
  const cy = y + offsetY;
  return {
    x0: x - width / 2 - gapPx,
    x1: x + width / 2 + gapPx,
    y0: cy - height / 2 - gapPx,
    y1: cy + height / 2 + gapPx,
  };
}

/** Placed boxes in a uniform grid, so a candidate only tests the boxes in
 *  the cells it covers — linear in the number of labels, not quadratic. */
function boxGrid() {
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
  return {
    place(box: Box) {
      for (const key of cellsOf(box)) {
        const cell = grid.get(key);
        if (cell) cell.push(box);
        else grid.set(key, [box]);
      }
    },
    hits(box: Box): boolean {
      return cellsOf(box).some((key) =>
        (grid.get(key) ?? []).some(
          (q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0
        )
      );
    },
  };
}

/**
 * Like `declutterByDistance`, but on the labels' BOXES: a centre gap says
 * nothing about two 20-character names, which are 140 px wide and collide
 * with their centres 80 px apart. Highest weight places first; a label whose
 * box (plus `gapPx` on every side) touches one already placed — or one of the
 * `obstacles` another layer already shows — is dropped.
 */
export function declutterByBoxes<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  positionOf: (item: T) => readonly [number, number],
  sizeOf: (item: T) => LabelBoxSize,
  zoom: number,
  { gapPx = 4, offsetY = 0, obstacles = [], project }: BoxDeclutterOptions = {}
): T[] {
  const toPx: LabelProjector = project ?? ((p) => projectToWorldPx(p[0], p[1], zoom));
  const grid = boxGrid();
  // Obstacles carry no gap of their own: the candidate's gap already keeps
  // the two apart.
  for (const o of obstacles) grid.place(boxAt(o.position, o.width, o.height, o.offsetY, toPx, 0));
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const accepted: T[] = [];
  for (const item of sorted) {
    const { width, height } = sizeOf(item);
    const box = boxAt(positionOf(item), width, height, offsetY, toPx, gapPx);
    if (grid.hits(box)) continue;
    accepted.push(item);
    grid.place(box);
  }
  return accepted;
}

export interface SpreadOptions extends BoxDeclutterOptions {
  /**
   * The pick stands for a range of zooms; `project` measures its bottom, and
   * this is how much larger the map is at its top (2 for a whole zoom step).
   */
  bucketScale?: number;
}

/** Where a label sits once `spreadByBoxes` has moved it off its usual spot. */
export interface SpreadLabel<T> {
  item: T;
  /** Pixels added to the label's usual offset; `[0, 0]` where it was free. */
  shift: readonly [number, number];
}

const NO_SHIFT: readonly [number, number] = [0, 0];
/** Free space between a moved pill and its own dot, in px. */
const SIDE_GAP_PX = 6;
/** How many pill heights a label may climb above, or sink below, its dot. */
const SPREAD_RUNGS = 2;

/**
 * The `k`-th spot `spreadByBoxes` tries for a pill of `width` × `height`
 * lifted `offsetY` px off its dot, as a shift from that usual spot: the
 * usual spot, under the dot, right and left of it, then rung by rung further
 * above and below — a rung is one pill plus the gap both neighbours keep.
 * `null` once the spots are used up.
 */
function spreadShift(
  k: number,
  width: number,
  height: number,
  offsetY: number,
  gapPx: number
): readonly [number, number] | null {
  const below = -2 * offsetY;
  const level = -offsetY;
  const side = width / 2 + SIDE_GAP_PX;
  if (k === 0) return NO_SHIFT;
  if (k === 1) return [0, below];
  if (k === 2) return [side, level];
  if (k === 3) return [-side, level];
  const rung = Math.floor((k - 4) / 2) + 1;
  if (rung > SPREAD_RUNGS) return null;
  const step = rung * (height + 2 * gapPx);
  return (k - 4) % 2 === 0 ? [0, -step] : [0, below + step];
}

/**
 * As many labels as fit without one printed over another: the labels'
 * answer to "show all of them" (beta.22 UAT — "all" used to skip the
 * collision pass, and "Kiel Hbf" and "Kiel Norwegenkai", 500 m apart, were one
 * smudge at every zoom). Highest weight places first on its usual spot; a
 * label that would touch one already placed, or an obstacle, moves to the
 * first free spot of `spreadShift` instead of disappearing. Only where a
 * cluster is so dense that none of those spots near its dot is free does a
 * label stay hidden until the map zooms in — a name printed over another, or
 * parked far from the dot it names, tells nobody anything.
 */
export function spreadByBoxes<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  positionOf: (item: T) => readonly [number, number],
  sizeOf: (item: T) => LabelBoxSize,
  zoom: number,
  { gapPx = 4, offsetY = 0, obstacles = [], project, bucketScale = 1 }: SpreadOptions = {}
): SpreadLabel<T>[] {
  const toPx: LabelProjector = project ?? ((p) => projectToWorldPx(p[0], p[1], zoom));
  // A moved pill no longer keeps its distance to its neighbours as the map
  // zooms — one under its dot can meet one lifted above the next dot — so a
  // spot must be free at both ends of the zoom the pick stands for.
  const ends: { grid: ReturnType<typeof boxGrid>; toPx: LabelProjector }[] = [
    { grid: boxGrid(), toPx },
  ];
  if (bucketScale !== 1) {
    ends.push({
      grid: boxGrid(),
      toPx: (p) => {
        const [x, y] = toPx(p);
        return [x * bucketScale, y * bucketScale];
      },
    });
  }
  for (const end of ends) {
    for (const o of obstacles) {
      end.grid.place(boxAt(o.position, o.width, o.height, o.offsetY, end.toPx, 0));
    }
  }
  const shifted = (box: Box, shift: readonly [number, number]): Box => ({
    x0: box.x0 + shift[0],
    x1: box.x1 + shift[0],
    y0: box.y0 + shift[1],
    y1: box.y1 + shift[1],
  });
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const placed: SpreadLabel<T>[] = [];
  sorted.forEach((item) => {
    const { width, height } = sizeOf(item);
    const usual = ends.map((end) =>
      boxAt(positionOf(item), width, height, offsetY, end.toPx, gapPx)
    );
    for (let k = 0; ; k++) {
      const shift = spreadShift(k, width, height, offsetY, gapPx);
      if (!shift) return;
      if (ends.every((end, i) => !end.grid.hits(shifted(usual[i], shift)))) {
        ends.forEach((end, i) => end.grid.place(shifted(usual[i], shift)));
        placed.push({ item, shift });
        return;
      }
    }
  });
  return placed;
}
