/**
 * Vendored country outlines, loaded once into a spatial index.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.
 * The owner drove through Estonia and Lithuania. TravStats stores curated
 * events, and a border crossing by car is not one, so those countries cannot
 * exist in it. Location history is the missing evidence class, and turning GPS
 * points into countries needs boundaries — resolved HERE rather than by asking
 * Dawarich, whose reverse geocoder most self-hosters do not run. Determinism is
 * the point: the same track yields the same countries on every instance.
 *
 * ## Data
 *
 * `backend/data/countries/countries-10m.geojson` — Natural Earth Admin 0
 * Countries at 1:10m, public domain, no attribution obligation. 10.2 MB, 245
 * polygonal features, 239 ISO 3166-1 alpha-2 codes, ~548 000 vertices.
 * `build-country-boundaries.mjs` beside it regenerates the file and carries the
 * measurements behind the resolution choice — in short: 1:110m has no polygon
 * for 26 of the countries a traveller can stand in, and 1:50m has the polygons
 * but answers St Peter's Square with IT and Monaco with null. A country
 * silently answered as its larger neighbour is worse than a large file.
 *
 * The Dockerfile copies the file into the production image. Without it this
 * module throws ENOENT on first use, exactly as the marnet graph does — see
 * `__tests__/countryBoundaries.test.ts`, which reads the Dockerfile to check
 * the COPY line is still there.
 *
 * ## Why two levels of index
 *
 * A sweep classifies a whole location history, so a naive scan is not an
 * option: at ~4 000 polygon parts, testing every one against every point is
 * four million ray casts per thousand points.
 *
 * 1. A 1° grid over the globe maps a cell to the parts whose bounding box
 *    touches it. That drops the candidate set from ~4 000 to a handful.
 * 2. Inside a candidate ring, the ray cast still walks every edge — and
 *    Canada's outline alone has ~30 000 of them, which measured at 52 000
 *    points/s and dominated everything else. So each ring additionally buckets
 *    its edges into latitude bands, and the cast visits only the band the query
 *    latitude falls in. That is exact, not an approximation: an edge is
 *    registered in every band its latitude span touches, so no crossing can be
 *    missed. Measured 484 000 points/s afterwards.
 *
 * The second index is why the vendored data is NOT simplified. Douglas-Peucker
 * at an adaptive tolerance was measured at 3.2 MB with every probe still
 * correct, but 0.26 % of random land points disagreed with its own source. It
 * bought only speed, and this buys speed without moving a single border.
 */

import fs from "fs";
import path from "path";

/**
 * Both `src/services/geo/` (ts-node/jest) and `dist/services/geo/` (production)
 * are two levels under their root, so the same climb lands at
 * `<backend>/data/countries/countries-10m.geojson`. Same shape as
 * `marnetGraph.ts`.
 */
export const COUNTRY_BOUNDARIES_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "countries",
  "countries-10m.geojson"
);

/**
 * Antarctica is in the data and is deliberately kept out of the index.
 *
 * `AQ` is an ISO 3166-1 code for a region, not for a state: the Antarctic
 * Treaty suspends every territorial claim, so no point there is inside a
 * country. The evidence tiers this feeds — slept, visited, transited — all
 * assert presence in a COUNTRY, and asserting one where sovereignty is
 * explicitly held in abeyance would be the invented value the whole design
 * exists to remove. Abstention is a result.
 *
 * The polygon stays in the vendored file rather than being stripped by the
 * build script, because the file is a faithful copy of Natural Earth and this
 * is a policy of ours. Policy lives in code where it can be read and tested;
 * see the South Pole case in `__tests__/countryFromCoordinates.test.ts`.
 */
const UNATTRIBUTED_CODES: ReadonlySet<string> = new Set(["AQ"]);

const GRID_COLUMNS = 360;
const GRID_ROWS = 180;

/**
 * Target edges per latitude band. Sixteen rather than one: a band per edge
 * would spend more memory on the index than the geometry costs, and the ray
 * cast is already cheap once the candidate set is a handful of edges. The cap
 * keeps a pathological ring from allocating tens of thousands of buckets.
 */
const EDGES_PER_BAND = 16;
const MAX_BANDS_PER_RING = 4096;

/**
 * Flat, typed, and read-only — the whole point is that a sweep may hammer this
 * without allocating. Indices are into the arrays below, never object refs.
 */
export interface CountryBoundaryIndex {
  /** ISO 3166-1 alpha-2 per polygon part, in file order. */
  readonly partCodes: readonly string[];
  /** `lon, lat` interleaved for every vertex of every ring. */
  readonly coords: Float64Array;
  /** Vertex range of ring `r`: `ringStart[r] .. ringStart[r + 1] - 1`. */
  readonly ringStart: Int32Array;
  /** Rings of part `p`: `partRingStart[p] .. partRingStart[p + 1] - 1`, outer first. */
  readonly partRingStart: Int32Array;
  /** `minLon, minLat, maxLon, maxLat` per part. */
  readonly partBox: Float64Array;
  /** Parts touching grid cell `c`: `cellStart[c] .. cellStart[c + 1] - 1` of `cellParts`. */
  readonly cellStart: Int32Array;
  readonly cellParts: Int32Array;
  /** Band slots of ring `r`: `ringBandStart[r] .. ringBandStart[r + 1] - 1`. */
  readonly ringBandStart: Int32Array;
  /** Edges of band slot `s`: `bandEdgeStart[s] .. bandEdgeStart[s + 1] - 1` of `bandEdges`. */
  readonly bandEdgeStart: Int32Array;
  /** Global index of an edge's FIRST vertex; the second is that plus one. */
  readonly bandEdges: Int32Array;
  readonly ringLatMin: Float64Array;
  readonly ringBandHeight: Float64Array;
  /** Every code the index can answer — the answer to "can it see Monaco". */
  readonly codes: ReadonlySet<string>;
}

type Ring = readonly (readonly number[])[];

interface RawFeature {
  properties?: { iso?: unknown };
  geometry?: { type?: unknown; coordinates?: unknown } | null;
}

/** Rejects anything that is not a closed-ish ring of finite lon/lat pairs. */
function isRing(value: unknown): value is Ring {
  if (!Array.isArray(value) || value.length < 4) return false;
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) return false;
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
  }
  return true;
}

function polygonsOf(geometry: RawFeature["geometry"]): Ring[][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const raw: unknown[] =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const polygons: Ring[][] = [];
  for (const polygon of raw) {
    if (!Array.isArray(polygon)) continue;
    const rings = polygon.filter(isRing);
    if (rings.length > 0) polygons.push(rings);
  }
  return polygons;
}

/** Accumulators for one pass over the features; converted to typed arrays at the end. */
interface Builder {
  partCodes: string[];
  coords: number[];
  ringStart: number[];
  partRingStart: number[];
  partBox: number[];
}

function addPart(builder: Builder, code: string, rings: Ring[]): void {
  builder.partRingStart.push(builder.ringStart.length - 1);
  builder.partCodes.push(code);

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (let r = 0; r < rings.length; r++) {
    for (const point of rings[r]) {
      const lon = point[0];
      const lat = point[1];
      builder.coords.push(lon, lat);
      // Only the OUTER ring defines the part's box. A hole is inside it by
      // definition, and a hole cannot make the part reach further.
      if (r === 0) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    builder.ringStart.push(builder.coords.length / 2);
  }
  builder.partBox.push(minLon, minLat, maxLon, maxLat);
}

/** CSR grid: parts per 1° cell, built by counting first so nothing is reallocated. */
function buildGrid(
  partCount: number,
  partBox: Float64Array
): { cellStart: Int32Array; cellParts: Int32Array } {
  const cellCount = GRID_COLUMNS * GRID_ROWS;
  const counts = new Int32Array(cellCount + 1);

  const forEachCell = (part: number, visit: (cell: number) => void): void => {
    const x0 = Math.max(0, Math.floor(partBox[part * 4] + 180));
    const x1 = Math.min(GRID_COLUMNS - 1, Math.floor(partBox[part * 4 + 2] + 180));
    const y0 = Math.max(0, Math.floor(partBox[part * 4 + 1] + 90));
    const y1 = Math.min(GRID_ROWS - 1, Math.floor(partBox[part * 4 + 3] + 90));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) visit(y * GRID_COLUMNS + x);
    }
  };

  for (let part = 0; part < partCount; part++) forEachCell(part, (cell) => void counts[cell + 1]++);
  for (let cell = 0; cell < cellCount; cell++) counts[cell + 1] += counts[cell];

  const cellStart = counts;
  const cellParts = new Int32Array(cellStart[cellCount]);
  const cursor = Int32Array.from(cellStart.subarray(0, cellCount));
  for (let part = 0; part < partCount; part++) {
    forEachCell(part, (cell) => {
      cellParts[cursor[cell]++] = part;
    });
  }
  return { cellStart, cellParts };
}

/** Per-ring latitude-band edge index. See the header for why it exists. */
function buildBands(
  ringCount: number,
  ringStart: Int32Array,
  coords: Float64Array
): Pick<
  CountryBoundaryIndex,
  "ringBandStart" | "bandEdgeStart" | "bandEdges" | "ringLatMin" | "ringBandHeight"
> {
  const ringBandStart = new Int32Array(ringCount + 1);
  const ringLatMin = new Float64Array(ringCount);
  const ringBandHeight = new Float64Array(ringCount);

  for (let ring = 0; ring < ringCount; ring++) {
    const from = ringStart[ring];
    const to = ringStart[ring + 1];
    let latMin = Infinity;
    let latMax = -Infinity;
    for (let v = from; v < to; v++) {
      const lat = coords[v * 2 + 1];
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
    const edges = Math.max(1, to - from - 1);
    const bands = Math.min(MAX_BANDS_PER_RING, Math.max(1, Math.ceil(edges / EDGES_PER_BAND)));
    ringLatMin[ring] = latMin;
    // A degenerate ring (all vertices on one parallel) gets a single band; a
    // zero height would make every band index Infinity.
    ringBandHeight[ring] = latMax > latMin ? (latMax - latMin) / bands : 0;
    ringBandStart[ring + 1] = ringBandStart[ring] + bands;
  }

  const slotCount = ringBandStart[ringCount];
  const counts = new Int32Array(slotCount + 1);

  const forEachSlot = (ring: number, edge: number, visit: (slot: number) => void): void => {
    const height = ringBandHeight[ring];
    const base = ringBandStart[ring];
    const bands = ringBandStart[ring + 1] - base;
    if (height === 0) {
      visit(base);
      return;
    }
    const latA = coords[edge * 2 + 1];
    const latB = coords[edge * 2 + 3];
    const low = Math.min(latA, latB);
    const high = Math.max(latA, latB);
    const first = Math.max(0, Math.min(bands - 1, Math.floor((low - ringLatMin[ring]) / height)));
    const last = Math.max(0, Math.min(bands - 1, Math.floor((high - ringLatMin[ring]) / height)));
    for (let band = first; band <= last; band++) visit(base + band);
  };

  for (let ring = 0; ring < ringCount; ring++) {
    for (let edge = ringStart[ring]; edge < ringStart[ring + 1] - 1; edge++) {
      forEachSlot(ring, edge, (slot) => void counts[slot + 1]++);
    }
  }
  for (let slot = 0; slot < slotCount; slot++) counts[slot + 1] += counts[slot];

  const bandEdgeStart = counts;
  const bandEdges = new Int32Array(bandEdgeStart[slotCount]);
  const cursor = Int32Array.from(bandEdgeStart.subarray(0, slotCount));
  for (let ring = 0; ring < ringCount; ring++) {
    for (let edge = ringStart[ring]; edge < ringStart[ring + 1] - 1; edge++) {
      forEachSlot(ring, edge, (slot) => {
        bandEdges[cursor[slot]++] = edge;
      });
    }
  }
  return { ringBandStart, bandEdgeStart, bandEdges, ringLatMin, ringBandHeight };
}

/**
 * Builds the index from already-parsed GeoJSON features.
 *
 * Exported so a test can index a two-country toy collection without the 10 MB
 * file, and so the file itself is never the only way in.
 */
export function buildCountryBoundaryIndex(features: readonly RawFeature[]): CountryBoundaryIndex {
  const builder: Builder = {
    partCodes: [],
    coords: [],
    ringStart: [0],
    partRingStart: [],
    partBox: [],
  };
  const codes = new Set<string>();

  for (const feature of features) {
    const iso = feature.properties?.iso;
    if (typeof iso !== "string" || !/^[A-Z]{2}$/.test(iso)) continue;
    if (UNATTRIBUTED_CODES.has(iso)) continue;
    const polygons = polygonsOf(feature.geometry);
    if (polygons.length === 0) continue;
    codes.add(iso);
    for (const rings of polygons) addPart(builder, iso, [...rings]);
  }

  const ringStart = Int32Array.from(builder.ringStart);
  const partRingStart = Int32Array.from([...builder.partRingStart, ringStart.length - 1]);
  const coords = Float64Array.from(builder.coords);
  const partBox = Float64Array.from(builder.partBox);
  const { cellStart, cellParts } = buildGrid(builder.partCodes.length, partBox);
  const bands = buildBands(ringStart.length - 1, ringStart, coords);

  return {
    partCodes: builder.partCodes,
    coords,
    ringStart,
    partRingStart,
    partBox,
    cellStart,
    cellParts,
    codes,
    ...bands,
  };
}

let cached: Promise<CountryBoundaryIndex> | null = null;

/**
 * Reads and indexes the vendored file.
 *
 * Parsed one feature per line rather than as one 10 MB `JSON.parse`, which is
 * why `build-country-boundaries.mjs` writes it that way: the whole document as
 * a single object peaks at several hundred megabytes of transient heap, and
 * this runs inside a container that also holds Prisma and Express.
 */
export async function loadCountryBoundaryIndex(
  filePath: string = COUNTRY_BOUNDARIES_PATH
): Promise<CountryBoundaryIndex> {
  const text = await fs.promises.readFile(filePath, "utf-8");
  const features: RawFeature[] = [];
  // Walked with indexOf rather than `split("\n")`: the split would hold a
  // second full copy of a 10 MB document alongside the first for no gain.
  for (let from = 0; from < text.length; ) {
    const end = text.indexOf("\n", from);
    const line = text.slice(from, end === -1 ? text.length : end);
    from = end === -1 ? text.length : end + 1;
    if (!line.startsWith('{"type":"Feature"')) continue;
    features.push(JSON.parse(line.endsWith(",") ? line.slice(0, -1) : line) as RawFeature);
  }
  if (features.length === 0) {
    throw new Error(`No country features in ${filePath} — the vendored dataset is missing or empty`);
  }
  return buildCountryBoundaryIndex(features);
}

/** The process-wide index. Built at most once, and only when something asks. */
export function getCountryBoundaryIndex(): Promise<CountryBoundaryIndex> {
  cached ??= loadCountryBoundaryIndex().catch((error) => {
    // A failed load must not be cached as a permanent failure: the next caller
    // gets a fresh attempt rather than a rejected promise forever.
    cached = null;
    throw error;
  });
  return cached;
}

/** Test seam — drops the memoised index so a fixture can replace it. */
export function resetCountryBoundaryIndexForTests(): void {
  cached = null;
}
