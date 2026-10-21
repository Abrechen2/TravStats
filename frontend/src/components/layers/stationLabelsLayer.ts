import { CompositeLayer, type Layer, type UpdateParameters, type Viewport } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import {
  declutterByBoxes,
  estimateLabelBox,
  spreadByBoxes,
  pickLabelled,
  projectToWorldPx,
  type LabelProjector,
  type LabelBoxSize,
  type LabelsMode,
  type PlacedLabel,
} from "../map/labelPriority";
import { toPortLabel } from "../map/portLabel";
import type { Rgb } from "../../lib/domainColor";

/**
 * Station names on the map for the ground domains — rail stations, bus
 * terminals, ferry ports (forgejo#320). A flight shows its airports, a cruise
 * its ports; a train ride drew its line and two nameless dots.
 *
 * The names are the ones stored on the ride (`depStationName` /
 * `arrStationName`), so nothing is looked up. Which names show is decided by
 * the SAME mechanism the airport, port and hotel labels use
 * (`map/labelPriority.ts`): the zoom budget is spent on the most-used stations
 * first, and the survivors are thinned by screen distance so a dense cluster
 * does not stack its names. In "all", where the user asked for every label,
 * a name that would land on another moves beside its dot instead; only where
 * no spot near the dot is free does it wait for the next zoom step.
 *
 * Unlike those layers this one is built OUTSIDE the map component (the
 * dashboard tabs and the trip map hand it in as an extra layer), where the
 * map's zoom does not exist. So it reads the zoom from its own viewport, snapped
 * to an integer exactly as `DeckGLMap` snaps the zoom it gives the airport
 * labels, and re-picks only when that integer, the map's turn or its tilt
 * changes — panning costs nothing. The collision pass measures through the
 * viewport's own projection (`stationLabelProjector`).
 */

/** What a label needs from a ride — a train, bus or ferry row, or a trip's slim one. */
export interface StationLabelSource {
  status: string;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  /** Rail rows carry a catalogue station; bus and ferry rows do not. */
  depStationId?: number | null;
  arrStationId?: number | null;
}

export interface StationLabelDatum {
  key: string;
  name: string;
  /** Truncated display text — see `toStationLabel`. */
  shortLabel: string;
  position: [number, number];
  /** How many drawn rides start or end here — the label-priority weight. */
  count: number;
  /** The domain colour, resolved by the caller from the domain colour store. */
  color: Rgb;
  /** The pill's estimated screen box — what the collision pass compares. */
  box: LabelBoxSize;
  /** Set only in "all": how far the pill moved off its usual spot, in px,
   *  so it does not print over a neighbour (`spreadByBoxes`). */
  shift?: readonly [number, number];
}

/**
 * Station names run long ("Berlin Hauptbahnhof (tief)"), and timetable dumps
 * are often shouty ("MUENCHEN HBF") — the port label's normalisation at the
 * hotel label's wider budget.
 */
const MAX_STATION_LABEL_LEN = 20;
/** The pill's font size and padding — read by the layer AND the box estimate. */
const LABEL_FONT_PX = 11;
const LABEL_PADDING_PX: [number, number] = [4, 2];
/** How far the pill sits above its station — the collision pass needs it to
 *  compare against labels lifted by a different amount. */
const LABEL_OFFSET_Y_PX = -14;
const USUAL_OFFSET: [number, number] = [0, LABEL_OFFSET_Y_PX];

export function toStationLabel(name: string): string {
  return toPortLabel(name, MAX_STATION_LABEL_LEN);
}

/** Stations closer than this are one place, whatever their spelling. */
export const SAME_STATION_M = 100;
/** Grid cell of the place index, in degrees — about the merge distance. */
const CELL_DEG = 0.001;

interface Pending {
  key: string;
  position: [number, number];
  count: number;
  /** Spelling → how many rides used it; the most used one names the label. */
  spellings: Map<string, number>;
  hasId: boolean;
}

const cellOf = (lon: number, lat: number): [number, number] => [
  Math.floor(lon / CELL_DEG),
  Math.floor(lat / CELL_DEG),
];

/** How many cells east and west `SAME_STATION_M` reaches at this latitude —
 *  capped, because a pole would need the whole row. One cell north-south is
 *  110 m, so one row either side is always enough there. */
function cellsWithin(lat: number): number {
  const cellM = 111_320 * Math.cos((lat * Math.PI) / 180) * CELL_DEG;
  return Math.min(50, Math.max(1, Math.ceil(SAME_STATION_M / Math.max(cellM, 1e-6))));
}

/** Equirectangular metres — exact enough at 100 m, and cheap. */
function metresBetween(a: [number, number], lon: number, lat: number): number {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((a[0] - lon) * kx, (a[1] - lat) * 110_574);
}

function usable(name: unknown, lon: number, lat: number): name is string {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    Number.isFinite(lon) &&
    Number.isFinite(lat)
  );
}

function mostUsed(spellings: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [spelling, count] of spellings) {
    if (count > bestCount) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Each station once, with how often it was used. A catalogue id names a
 * station even where two rides stored slightly different coordinates. Without
 * one (bus, ferry, a hand-entered stop) the PLACE does: every row within
 * `SAME_STATION_M` of a station is that station, however it was spelled —
 * "München Hbf" and "Muenchen Hbf" on one platform used to split their count
 * and print two names on top of each other. The label shows the spelling the
 * rides used most. A row without an id joins the nearest station, with or
 * without one; two DIFFERENT catalogue ids stay two stations even when they
 * share a place ("Berlin Hbf" and "Berlin Hbf (tief)").
 *
 * The place index is a grid, so this stays linear in the number of rides.
 *
 * A cancelled ride never ran and draws no line, so it names no station either —
 * the reading every route builder takes of it.
 */
export function buildStationLabels(
  rides: readonly StationLabelSource[],
  color: Rgb
): StationLabelDatum[] {
  const byId = new Map<string, Pending>();
  const grid = new Map<string, Pending[]>();
  const out: Pending[] = [];
  const nearest = (lon: number, lat: number): Pending | undefined => {
    const [cx, cy] = cellOf(lon, lat);
    let best: Pending | undefined;
    let bestM = SAME_STATION_M;
    // A cell is CELL_DEG wide in degrees, so narrower in metres the further
    // from the equator: 68 m at 52.5° N, where 100 m spans two cells. Search
    // as many as the merge distance covers here (Codex review).
    const rx = cellsWithin(lat);
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const m = metresBetween(p.position, lon, lat);
          if (m <= bestM) {
            best = p;
            bestM = m;
          }
        }
      }
    }
    return best;
  };
  const idKeyOf = (id: number | null | undefined) =>
    id === null || id === undefined ? null : `id:${id}`;
  /** The station a row belongs to, if it is already known. An id never joins
   *  a place already claimed by another id. */
  const resolve = (lon: number, lat: number, idKey: string | null): Pending | undefined => {
    const near = nearest(lon, lat);
    return idKey ? (byId.get(idKey) ?? (near && !near.hasId ? near : undefined)) : near;
  };
  const touch = (name: unknown, lon: number, lat: number, id: number | null | undefined) => {
    if (!usable(name, lon, lat)) return null;
    const idKey = idKeyOf(id);
    const existing = resolve(lon, lat, idKey);
    const entry: Pending = existing ?? {
      key: idKey ?? `@${lon.toFixed(4)},${lat.toFixed(4)}`,
      position: [lon, lat],
      count: 0,
      spellings: new Map(),
      hasId: false,
    };
    if (!existing) {
      out.push(entry);
      const [cx, cy] = cellOf(lon, lat);
      const cell = `${cx}:${cy}`;
      grid.set(cell, [...(grid.get(cell) ?? []), entry]);
    }
    if (idKey && !entry.hasId) {
      entry.hasId = true;
      entry.key = idKey;
      byId.set(idKey, entry);
    }
    entry.count += 1;
    const spelling = name.trim();
    entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
    return entry;
  };
  for (const ride of rides) {
    if (ride.status === "cancelled") continue;
    const dep = touch(ride.depStationName, ride.depLon, ride.depLat, ride.depStationId);
    // A round trip on one station counts once per ride, not twice.
    const sameStation =
      dep !== null &&
      usable(ride.arrStationName, ride.arrLon, ride.arrLat) &&
      resolve(ride.arrLon, ride.arrLat, idKeyOf(ride.arrStationId)) === dep;
    if (!sameStation) touch(ride.arrStationName, ride.arrLon, ride.arrLat, ride.arrStationId);
  }
  return out.map((p) => {
    const name = mostUsed(p.spellings);
    const shortLabel = toStationLabel(name);
    return {
      key: p.key,
      name,
      shortLabel,
      position: p.position,
      count: p.count,
      color,
      box: estimateLabelBox(shortLabel, LABEL_FONT_PX, LABEL_PADDING_PX),
    };
  });
}

/**
 * The labels shown at one zoom: the airport labels' zoom budget, then a
 * collision pass on the labels' estimated boxes. The 42 px centre gap the
 * airport codes use is right for three letters and wrong for a 20-character
 * station name, which is over 100 px wide (Codex review). The callers hand in
 * every domain's stations at once, so a train station and a bus terminal at
 * the same interchange compete in ONE pass instead of being printed over each
 * other by two.
 *
 * `obstacles` are the labels the map already shows — airport codes, ports,
 * hotels, places (`map/labelObstacles.ts`). They place first and a station
 * name fits around them, so the overview map prints no name over another.
 *
 * "all" thins nothing by budget: a name that would print over another moves
 * to a free spot beside its dot (`spreadByBoxes`, beta.22 UAT), and waits for
 * the next zoom step only where no such spot is free. It also drops a
 * repeat — the same name at the same place from a second domain ("Kiel Hbf"
 * for the train and the bus), which is one station, not two.
 *
 * `zoom` is the snapped zoom, which stands for everything from half a step
 * below it; the pick holds for that whole bucket, so the geometry is measured
 * at its smallest scale — at the bucket's top two names 180 px apart are only
 * 127 px apart at its bottom (Codex review). `project`, when the layer has its
 * viewport, measures a turned or tilted map as it is drawn.
 */
export function selectStationLabels(
  stations: readonly StationLabelDatum[],
  mode: LabelsMode,
  zoom: number,
  obstacles: readonly PlacedLabel[] = [],
  project: LabelProjector = (p) => projectToWorldPx(p[0], p[1], zoom - ZOOM_BUCKET_HALF)
): StationLabelDatum[] {
  const budgeted = pickLabelled(stations, (s) => s.count, mode, zoom);
  if (mode === "all") {
    return spreadByBoxes(
      withoutRepeats(budgeted),
      (s) => s.count,
      (s) => s.position,
      (s) => s.box,
      zoom,
      { offsetY: LABEL_OFFSET_Y_PX, obstacles, project, bucketScale: 2 ** (2 * ZOOM_BUCKET_HALF) }
    ).map(({ item, shift }) => (shift[0] === 0 && shift[1] === 0 ? item : { ...item, shift }));
  }
  return declutterByBoxes(
    budgeted,
    (s) => s.count,
    (s) => s.position,
    (s) => s.box,
    zoom,
    { offsetY: LABEL_OFFSET_Y_PX, obstacles, project }
  );
}

/** The stations minus a second domain's copy of one already named at the same
 *  place — the busier copy stays. */
function withoutRepeats(stations: readonly StationLabelDatum[]): StationLabelDatum[] {
  const kept = new Map<string, StationLabelDatum[]>();
  const out: StationLabelDatum[] = [];
  for (const s of [...stations].sort((a, b) => b.count - a.count)) {
    const same = kept.get(s.shortLabel);
    if (
      same?.some((k) => metresBetween(k.position, s.position[0], s.position[1]) <= SAME_STATION_M)
    )
      continue;
    if (same) same.push(s);
    else kept.set(s.shortLabel, [s]);
    out.push(s);
  }
  return out;
}

/** `snapLabelZoom` rounds, so one snapped zoom covers half a step either side. */
const ZOOM_BUCKET_HALF = 0.5;

/**
 * The viewport's own projection — bearing and pitch included — scaled down to
 * the bottom of the snapped zoom's bucket. Pills stay upright on screen while
 * the map turns, so north-south neighbours stacked on a north-up map stand
 * side by side on a turned one; a north-up Mercator pass never saw that.
 */
export function stationLabelProjector(viewport: Viewport): LabelProjector {
  const scale = 2 ** (snapLabelZoom(viewport.zoom) - ZOOM_BUCKET_HALF - viewport.zoom);
  return (p) => {
    const [x, y] = viewport.project([p[0], p[1]]);
    return [x * scale, y * scale];
  };
}

/** What the pick depends on: the snapped zoom and the camera's turn and tilt
 *  (in 5° steps) — not its position, so panning costs nothing. */
export function labelViewKey(viewport: Viewport): string {
  const v = viewport as Viewport & { bearing?: number; pitch?: number };
  return [
    snapLabelZoom(viewport.zoom),
    Math.round((v.bearing ?? 0) / 5),
    Math.round((v.pitch ?? 0) / 5),
  ].join("|");
}

/** The integer zoom the pick is made at — `DeckGLMap`'s snap for its own labels. */
export const snapLabelZoom = (zoom: number): number => Math.round(zoom);

export interface StationLabelsLayerProps {
  id: string;
  /** Every domain's stations together, each carrying its domain colour. */
  data: readonly StationLabelDatum[];
  labelsMode: LabelsMode;
  /**
   * On the globe the layer draws nothing itself — deck.gl 9's billboard text
   * does not render under MapLibre's globe projection — and only CARRIES the
   * stations to `GlobeView`, which hands them to the HTML label overlay
   * (`stationLabelPoints` in `Globe/globePinLabels.ts`).
   */
  onGlobe?: boolean;
  /** Labels other layers already show; set by `DeckGLMap` (`withLabelObstacles`). */
  obstacles?: readonly PlacedLabel[];
}

interface StationLabelsState {
  viewKey: string;
  labels: StationLabelDatum[];
  [key: string]: unknown;
}

export class StationLabelsLayer extends CompositeLayer<StationLabelsLayerProps> {
  static layerName = "StationLabelsLayer";

  declare state: StationLabelsState;

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    if (changeFlags.propsOrDataChanged) return true;
    if (this.props.onGlobe) return false;
    return (
      Boolean(changeFlags.viewportChanged) &&
      labelViewKey(this.context.viewport) !== this.state.viewKey
    );
  }

  updateState(): void {
    const { viewport } = this.context;
    const { data, labelsMode, onGlobe, obstacles } = this.props;
    const labels = onGlobe
      ? []
      : selectStationLabels(
          data,
          labelsMode,
          snapLabelZoom(viewport.zoom),
          obstacles,
          stationLabelProjector(viewport)
        );
    this.setState({ viewKey: labelViewKey(viewport), labels });
  }

  renderLayers(): Layer[] {
    const { labelsMode, onGlobe } = this.props;
    if (onGlobe) return [];
    return [
      new TextLayer<StationLabelDatum>(
        this.getSubLayerProps({
          id: "text",
          data: this.state.labels,
          getPosition: (d: StationLabelDatum) => d.position,
          getText: (d: StationLabelDatum) => d.shortLabel,
          // The port and hotel labels' look: light text on the dark pill, the
          // border in the domain's own colour so a name says whose it is.
          getColor: [241, 245, 249, 235],
          getSize: LABEL_FONT_PX,
          fontFamily: "Inter, sans-serif",
          fontWeight: 700,
          background: true,
          backgroundPadding: LABEL_PADDING_PX,
          getBackgroundColor: [13, 17, 23, 200],
          getBorderColor: (d: StationLabelDatum) => [...d.color, 200],
          getBorderWidth: 1,
          getPixelOffset: (d: StationLabelDatum) =>
            d.shift ? [d.shift[0], LABEL_OFFSET_Y_PX + d.shift[1]] : USUAL_OFFSET,
          sizeUnits: "pixels",
          billboard: true,
          pickable: false,
          // Station names carry umlauts and accents ("Zürich HB", "Malmö C").
          // deck.gl's default `characterSet` is ASCII 32-127 and silently
          // drops the rest from the font atlas (#185) — do not remove "auto".
          characterSet: "auto",
          visible: labelsMode !== "off",
        })
      ),
    ];
  }
}

/** One domain's drawn rides and the colour its lines are drawn in. */
export interface StationLabelGroup {
  rides: readonly StationLabelSource[];
  color: Rgb;
}

export interface StationLabelOptions {
  labelsMode: LabelsMode;
  idPrefix: string;
  /** On the globe the layer only carries the stations to the HTML label overlay. */
  onGlobe?: boolean;
}

/**
 * ONE label layer for every domain handed in, or nothing. Built from the SAME
 * rows the callers drew their lines from, so a domain the filter switched off
 * (no rows) names no station either; one layer, so one collision pass.
 */
export function buildStationLabelLayers(
  groups: readonly StationLabelGroup[],
  { labelsMode, idPrefix, onGlobe = false }: StationLabelOptions
): Layer[] {
  if (labelsMode === "off") return [];
  const data = groups.flatMap((g) => buildStationLabels(g.rides, g.color));
  if (data.length === 0) return [];
  return [new StationLabelsLayer({ id: `${idPrefix}-station-labels`, data, labelsMode, onGlobe })];
}
