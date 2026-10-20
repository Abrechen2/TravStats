import { CompositeLayer, type Layer, type UpdateParameters } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import {
  declutterByBoxes,
  estimateLabelBox,
  pickLabelled,
  type LabelBoxSize,
  type LabelsMode,
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
 * does not stack its names — skipped in "all", where the user asked for every
 * label.
 *
 * Unlike those layers this one is built OUTSIDE the map component (the
 * dashboard tabs and the trip map hand it in as an extra layer), where the
 * map's zoom does not exist. So it reads the zoom from its own viewport, snapped
 * to an integer exactly as `DeckGLMap` snaps the zoom it gives the airport
 * labels, and re-picks only when that integer changes — panning costs nothing.
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
    for (let dx = -1; dx <= 1; dx++) {
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
 */
export function selectStationLabels(
  stations: readonly StationLabelDatum[],
  mode: LabelsMode,
  zoom: number
): StationLabelDatum[] {
  const budgeted = pickLabelled(stations, (s) => s.count, mode, zoom);
  if (mode === "all") return budgeted;
  return declutterByBoxes(
    budgeted,
    (s) => s.count,
    (s) => s.position,
    (s) => s.box,
    zoom
  );
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
}

interface StationLabelsState {
  zoom: number;
  labels: StationLabelDatum[];
  [key: string]: unknown;
}

export class StationLabelsLayer extends CompositeLayer<StationLabelsLayerProps> {
  static layerName = "StationLabelsLayer";

  declare state: StationLabelsState;

  private viewportZoom(): number {
    return snapLabelZoom(this.context.viewport.zoom);
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    if (changeFlags.propsOrDataChanged) return true;
    if (this.props.onGlobe) return false;
    return Boolean(changeFlags.viewportChanged) && this.viewportZoom() !== this.state.zoom;
  }

  updateState(): void {
    const zoom = this.viewportZoom();
    const { data, labelsMode, onGlobe } = this.props;
    const labels = onGlobe ? [] : selectStationLabels(data, labelsMode, zoom);
    this.setState({ zoom, labels });
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
          getPixelOffset: [0, -14],
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
