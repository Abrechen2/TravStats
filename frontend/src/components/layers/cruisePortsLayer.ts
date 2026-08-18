import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise, Port } from "../../types";
import { toPortLabel } from "../map/portLabel";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";
import { markerDotRadiusProps } from "./markerDotStyle";

interface PortDatum {
  position: [number, number];
  portId: number;
  name: string;
  /**
   * Readable label rendered on the marker — the port name, lightly
   * normalised + truncated via `toPortLabel`. Airports show their IATA
   * code, but UN/LOCODEs ("ITCVV") mean nothing to users, so ports show
   * the real name instead.
   */
  shortLabel: string;
  /** ISO 3166-1 alpha-2 country code — drives the flag in the hover tooltip. */
  country?: string | null;
  /** City the port serves — shown in the hover tooltip's place line. */
  city?: string | null;
  visits: number;
  /** ISO date of the most recent stop at this port (max of
   *  stop.arrivalTime across cruises). Surfaced in the hover tooltip. */
  lastVisit?: string;
}

// The solid centre dot's radius (metres + pixel clamps) is shared with
// the airport `routes-dot` layer via markerDotStyle.ts (#187) so flat-map
// ports read as the same visual weight as airport markers. The halo ring
// below stays port-specific — only the dot sizing model is shared.
const PORT_RING_RADIUS_M = 6000;
// Cruise domain hex per BRAND.md §3 (--domain-cruise = #6fa0d6 / rgb(111,160,214)).
// Was sky-400 [56, 189, 248] which is a different blue and not in the brand
// palette — port markers are the primary on-map signifier of the cruise
// domain so they have to render in the canonical domain colour.
// Exported so the map LEGEND can name this mark without keeping a second copy
// of the colour — the rule the 2.4.0 colour-mode work established: a legend
// swatch is resolved from the same source the layer paints with, never typed
// in beside it.
export const PORT_RGB: [number, number, number] = [111, 160, 214];

/**
 * Match the airport-label zoom gate from routesLayer
 * (LABEL_VISIBILITY_MIN_ZOOM). Below this zoom the dots stay visible
 * but the UN/LOCODE labels are hidden — at world view dozens of
 * 5-letter codes overlap into noise.
 */
const PORT_LABEL_VISIBILITY_MIN_ZOOM = 4;

/**
 * Build a stack of layers (halo ring, solid dot, label) for unique
 * ports visited across all cruises. At-sea stops and stops without a
 * resolved port are ignored.
 *
 * `zoom` gates the label layer visibility — same threshold as airport
 * IATA labels (LABEL_VISIBILITY_MIN_ZOOM in routesLayer). Defaults to
 * "always visible" so legacy callers without zoom plumbing don't break.
 *
 * Returns `null` when no qualifying ports exist.
 */
/** Appearance overrides for cruise-port markers (from the flat-map panel). */
export interface PortsAppearance {
  /** Port marker fill/ring colour (RGB). Falls back to the built-in blue. */
  portColor?: [number, number, number];
  /** Multiplier on the port marker + ring pixel radii (1 = default). */
  portSizeScale?: number;
  /** Port-label reveal: off / key ports only (priority by visits, the
   *  default) / all. Replaces the old hard zoom gate. */
  labelsMode?: LabelsMode;
}

export function createCruisePortsLayer(
  cruises: Cruise[],
  zoom: number = PORT_LABEL_VISIBILITY_MIN_ZOOM,
  appearance: PortsAppearance = {}
): Layer[] | null {
  const { portColor, portSizeScale = 1, labelsMode = "important" } = appearance;
  const portRgb = portColor ?? PORT_RGB;
  const byPort = new Map<number, PortDatum>();
  const recordVisit = (port: Port, date: string | undefined): void => {
    const existing = byPort.get(port.id);
    if (existing) {
      existing.visits += 1;
      if (date && (!existing.lastVisit || date > existing.lastVisit)) {
        existing.lastVisit = date;
      }
    } else {
      byPort.set(port.id, {
        position: [port.lon, port.lat],
        portId: port.id,
        name: port.name,
        shortLabel: toPortLabel(port.name),
        country: port.country,
        city: port.city,
        visits: 1,
        lastVisit: date,
      });
    }
  };
  for (const cruise of cruises) {
    // A scheduled/in-progress/cancelled cruise hasn't (fully) sailed —
    // only flown/historical port calls count as an actual visit.
    if (cruise.status !== "flown" && cruise.status !== "historical") continue;
    const firstPortCall = cruise.stops.find((s) => !s.isAtSea && s.port);
    const lastPortCall = [...cruise.stops].reverse().find((s) => !s.isAtSea && s.port);
    // Departure/arrival ports get markers too — skipped only when they
    // duplicate the first/last port-call stop (counted there instead).
    if (cruise.departurePort && cruise.departurePort.id !== firstPortCall?.port?.id) {
      recordVisit(cruise.departurePort, cruise.startDate ?? undefined);
    }
    for (const stop of cruise.stops) {
      if (stop.isAtSea || !stop.port) continue;
      recordVisit(stop.port, stop.arrivalTime ?? stop.departureTime ?? undefined);
    }
    if (cruise.arrivalPort && cruise.arrivalPort.id !== lastPortCall?.port?.id) {
      recordVisit(cruise.arrivalPort, cruise.endDate ?? undefined);
    }
  }
  const data = Array.from(byPort.values());
  if (data.length === 0) return null;

  const ringLayer = new ScatterplotLayer<PortDatum>({
    id: "cruise-ports-ring",
    data,
    getPosition: (d) => d.position,
    getRadius: PORT_RING_RADIUS_M,
    radiusMinPixels: 7 * portSizeScale,
    radiusMaxPixels: 14 * portSizeScale,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...portRgb, 80] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 1,
    pickable: false,
  });

  const dotLayer = new ScatterplotLayer<PortDatum>({
    id: "cruise-ports",
    data,
    getPosition: (d) => d.position,
    // Cap the marker so it stays a recognisable dot at every zoom —
    // sub-pixel meters at low zoom collapse to just the white stroke
    // (visible "clipping"), and at very high zoom the meter radius
    // would balloon to cover the entire port city. Shared with the
    // airport dot via markerDotStyle.ts (#187).
    ...markerDotRadiusProps(portSizeScale),
    getFillColor: [...portRgb, 220] as [number, number, number, number],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });

  // Priority label reveal: the most-visited ports keep their label even
  // when zoomed out; the rest fill in as the zoom budget grows. Then
  // decluttered by screen distance so a dense cluster of busy ports doesn't
  // stack labels on top of each other (#label-overlap) — skipped in "all"
  // mode, where the user explicitly asked to see every label.
  const budgeted = pickLabelled(data, (d) => d.visits, labelsMode, zoom);
  const labelData =
    labelsMode === "all"
      ? budgeted
      : declutterByDistance(
          budgeted,
          (d) => d.visits,
          (d) => d.position,
          zoom
        );
  const labelLayer = new TextLayer<PortDatum>({
    id: "cruise-ports-labels",
    data: labelData,
    getPosition: (d) => d.position,
    getText: (d) => d.shortLabel,
    getColor: [241, 245, 249, 235],
    getSize: 11,
    fontFamily: "Inter, sans-serif",
    fontWeight: 700,
    background: true,
    backgroundPadding: [4, 2],
    getBackgroundColor: [13, 17, 23, 200],
    getBorderColor: [...PORT_RGB, 200] as [number, number, number, number],
    getBorderWidth: 1,
    getPixelOffset: [0, -16],
    sizeUnits: "pixels",
    pickable: true,
    billboard: true,
    // Port names come straight from the catalog (e.g. "Travemünde") and
    // routinely contain umlauts/accents. deck.gl's default `characterSet`
    // only covers ASCII 32-127, so anything outside that range is silently
    // dropped from the font atlas and never renders (#185). "auto" builds
    // the atlas from the actual label text instead — do not remove.
    characterSet: "auto",
    visible: labelsMode !== "off",
  });

  return [ringLayer, dotLayer, labelLayer];
}
