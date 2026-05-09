import type { PickingInfo } from "@deck.gl/core";

// Marker layer ids that should surface a hover tooltip with the
// full place name. Listed explicitly so unrelated pickable layers
// (route arcs, cruise paths) don't accidentally hijack the cursor.
//
// Flat-map AIRPORTS are intentionally excluded — DeckGLMap already
// shows the rich `AirportTooltip` (departures / arrivals / distance
// / route counts) on click; layering a hover bubble on top would
// double up with that. Flat-map ports + every globe marker get the
// hover bubble because they have no equivalent rich tooltip.
const TOOLTIP_LAYER_IDS = new Set<string>([
  // Flat-map cruise ports (no rich tooltip exists yet)
  "cruise-ports",
  "cruise-ports-labels",
  // Globe airport stack
  "globe-airport-dots",
  "globe-airport-labels",
  // Globe cruise ports
  "globe-port-dots",
  "globe-port-labels",
]);

interface NamedDatum {
  readonly name?: string;
  readonly iata?: string;
  readonly shortLabel?: string;
}

/**
 * Hover tooltip for airport + port markers. Returns the full place
 * name in a styled bubble so users can see "Hamburg" while the
 * marker label only shows the short code "DEHAM" (or "HAM" for
 * airports). Routes / arcs / paths are intentionally skipped — they
 * would either be wrong (no single name) or distracting on hover.
 *
 * Designed to be passed directly as MapboxOverlay's `getTooltip`.
 */
export function buildMarkerTooltip(
  info: PickingInfo
): { text: string; style: Record<string, string> } | null {
  const layerId = info.layer?.id;
  if (!layerId || !TOOLTIP_LAYER_IDS.has(layerId)) return null;

  const datum = info.object as NamedDatum | undefined | null;
  if (!datum) return null;

  // Prefer `name` (full place name); fall back to whatever short-form
  // identifier the layer carries so the tooltip never renders empty.
  const text = datum.name ?? datum.iata ?? datum.shortLabel;
  if (!text) return null;

  return {
    text,
    style: {
      background: "rgba(13, 17, 23, 0.92)",
      color: "rgba(241, 245, 249, 0.96)",
      border: "1px solid rgba(255, 255, 255, 0.18)",
      borderRadius: "6px",
      padding: "5px 9px",
      fontSize: "12px",
      fontFamily: "'Inter', sans-serif",
      fontWeight: "500",
      letterSpacing: "0.01em",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
    },
  };
}
