import { CompositeLayer, type Layer, type UpdateParameters } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";
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
}

/**
 * Station names run long ("Berlin Hauptbahnhof (tief)"), and timetable dumps
 * are often shouty ("MUENCHEN HBF") — the port label's normalisation at the
 * hotel label's wider budget.
 */
const MAX_STATION_LABEL_LEN = 20;

export function toStationLabel(name: string): string {
  return toPortLabel(name, MAX_STATION_LABEL_LEN);
}

/**
 * The name-and-place key of a station, or null for one that cannot be labelled:
 * no name, or no coordinates (rows are external data, whatever their type says).
 */
function coordKey(name: unknown, lon: number, lat: number): string | null {
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return `${name.trim().toLocaleLowerCase()}@${lon.toFixed(4)},${lat.toFixed(4)}`;
}

/**
 * Each station once, with how often it was used. A catalogue id names a
 * station even where two rides stored slightly different coordinates; without
 * one (bus, ferry, a hand-entered stop) the name and the coordinates do. Both
 * keys point at one entry, so a ride with an id and one without still meet.
 *
 * A cancelled ride never ran and draws no line, so it names no station either —
 * the reading every route builder takes of it.
 */
export function buildStationLabels(rides: readonly StationLabelSource[]): StationLabelDatum[] {
  const byKey = new Map<string, StationLabelDatum>();
  const out: StationLabelDatum[] = [];
  const touch = (name: string, lon: number, lat: number, id: number | null | undefined) => {
    const nameKey = coordKey(name, lon, lat);
    if (nameKey === null) return;
    const idKey = id === null || id === undefined ? null : `id:${id}`;
    const existing = (idKey ? byKey.get(idKey) : undefined) ?? byKey.get(nameKey);
    const entry = existing ?? {
      key: idKey ?? nameKey,
      name: name.trim(),
      shortLabel: toStationLabel(name),
      position: [lon, lat] as [number, number],
      count: 0,
    };
    if (!existing) out.push(entry);
    entry.count += 1;
    if (idKey) byKey.set(idKey, entry);
    byKey.set(nameKey, entry);
  };
  for (const ride of rides) {
    if (ride.status === "cancelled") continue;
    touch(ride.depStationName, ride.depLon, ride.depLat, ride.depStationId);
    // A round trip on one station counts once per ride, not twice.
    const depKey = coordKey(ride.depStationName, ride.depLon, ride.depLat);
    const sameStation =
      depKey !== null && depKey === coordKey(ride.arrStationName, ride.arrLon, ride.arrLat);
    if (!sameStation) touch(ride.arrStationName, ride.arrLon, ride.arrLat, ride.arrStationId);
  }
  return out;
}

/** The labels shown at one zoom — the airport labels' pick, verbatim. */
export function selectStationLabels(
  stations: readonly StationLabelDatum[],
  mode: LabelsMode,
  zoom: number
): StationLabelDatum[] {
  const budgeted = pickLabelled(stations, (s) => s.count, mode, zoom);
  if (mode === "all") return budgeted;
  return declutterByDistance(
    budgeted,
    (s) => s.count,
    (s) => s.position,
    zoom
  );
}

/** The integer zoom the pick is made at — `DeckGLMap`'s snap for its own labels. */
export const snapLabelZoom = (zoom: number): number => Math.round(zoom);

export interface StationLabelsLayerProps {
  id: string;
  data: readonly StationLabelDatum[];
  /** The domain colour, resolved by the caller from the domain colour store. */
  color: Rgb;
  labelsMode: LabelsMode;
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
    return Boolean(changeFlags.viewportChanged) && this.viewportZoom() !== this.state.zoom;
  }

  updateState(): void {
    const zoom = this.viewportZoom();
    const { data, labelsMode } = this.props;
    this.setState({ zoom, labels: selectStationLabels(data, labelsMode, zoom) });
  }

  renderLayers(): Layer[] {
    const { color, labelsMode } = this.props;
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
          getSize: 11,
          fontFamily: "Inter, sans-serif",
          fontWeight: 700,
          background: true,
          backgroundPadding: [4, 2],
          getBackgroundColor: [13, 17, 23, 200],
          getBorderColor: [...color, 200],
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
          updateTriggers: { getBorderColor: color },
        })
      ),
    ];
  }
}

export interface StationLabelOptions {
  color: Rgb;
  labelsMode: LabelsMode;
  idPrefix: string;
  /** Labels are a flat-map layer; on the globe the HTML label overlay owns names. */
  onGlobe?: boolean;
}

/**
 * The label layer for one domain's drawn rides, or nothing. Built from the
 * SAME rows the caller drew its lines from, so a domain the filter switched
 * off (no rows) names no station either.
 */
export function buildStationLabelLayers(
  rides: readonly StationLabelSource[],
  { color, labelsMode, idPrefix, onGlobe = false }: StationLabelOptions
): Layer[] {
  if (onGlobe || labelsMode === "off") return [];
  const data = buildStationLabels(rides);
  if (data.length === 0) return [];
  return [new StationLabelsLayer({ id: `${idPrefix}-station-labels`, data, color, labelsMode })];
}
