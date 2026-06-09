import type { PickingInfo } from "@deck.gl/core";
import { escapeHtml } from "../../lib/escapeHtml";

// Marker layer ids that should surface a hover tooltip with the rich
// content (short label + full name + visit count + last visit date).
// Listed explicitly so unrelated pickable layers (route arcs, cruise
// paths) don't accidentally hijack the cursor.
const AIRPORT_LAYER_IDS = new Set<string>([
  // Flat-map airport stack (routesLayer)
  "routes-dot",
  "routes-labels",
  // Globe airport stack — kept here for completeness even though
  // GlobeView no longer wires `getTooltip` (it owns its own React
  // tooltip). Keeps the factory portable across surfaces.
  "globe-airport-dots",
  "globe-airport-labels",
]);
const PORT_LAYER_IDS = new Set<string>([
  // Flat-map cruise ports
  "cruise-ports",
  "cruise-ports-labels",
  // Globe cruise ports
  "globe-port-dots",
  "globe-port-labels",
]);

interface AirportDatum {
  readonly iata?: string;
  readonly name?: string;
  /** Visits / flight count touching this airport. */
  readonly count?: number;
  /** ISO date of the most recent flight touching this airport. */
  readonly lastVisit?: string;
}

interface PortDatum {
  readonly name?: string;
  readonly shortLabel?: string;
  /** UN/LOCODE for globe-port-dots — the globe carries it as `iata`
   *  while the flat map carries it as `shortLabel`. */
  readonly iata?: string;
  /** Visits / cruise-stop count at this port. */
  readonly visits?: number;
  /** Globe carries the same number as `size` instead of `visits`. */
  readonly size?: number;
  /** ISO date of the most recent stop at this port. */
  readonly lastVisit?: string;
}

const SURFACE_STYLE: Record<string, string> = {
  background: "rgba(13, 17, 23, 0.92)",
  color: "rgba(241, 245, 249, 0.96)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: "6px",
  padding: "6px 9px",
  fontSize: "11.5px",
  fontFamily: "'Inter', sans-serif",
  letterSpacing: "0.01em",
  pointerEvents: "none",
  whiteSpace: "nowrap",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
  lineHeight: "1.35",
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Factory for the deck.gl `getTooltip` callback. Threads `t` and the
 * active locale into the closure so the rendered date + count labels
 * follow the user's language without restarting the overlay.
 *
 * Designed so the same callback can be plugged into every flat-map
 * MapboxOverlay (DeckGLMap, CruiseRouteMap, TripMap). The globe owns
 * its own React-state tooltip via `onAirportHover` / `onPortHover` and
 * does not use this factory.
 */
export function createMarkerTooltip(
  t: TFn,
  locale: string,
): (info: PickingInfo) => { html: string; style: Record<string, string> } | null {
  return function getTooltip(info: PickingInfo) {
    const layerId = info.layer?.id;
    if (!layerId) return null;

    if (AIRPORT_LAYER_IDS.has(layerId)) {
      const datum = info.object as AirportDatum | undefined | null;
      if (!datum) return null;
      const heading = datum.iata ?? datum.name;
      if (!heading) return null;
      const html = renderAirportHtml(datum, heading, t, locale);
      return { html, style: SURFACE_STYLE };
    }

    if (PORT_LAYER_IDS.has(layerId)) {
      const datum = info.object as PortDatum | undefined | null;
      if (!datum) return null;
      const heading = datum.name ?? datum.shortLabel ?? datum.iata;
      if (!heading) return null;
      const html = renderPortHtml(datum, heading, t, locale);
      return { html, style: SURFACE_STYLE };
    }

    return null;
  };
}

function renderAirportHtml(
  d: AirportDatum,
  heading: string,
  t: TFn,
  locale: string,
): string {
  const name = d.name && d.name !== heading ? d.name : null;
  const count = typeof d.count === "number" && d.count > 0 ? d.count : null;
  const lastVisit = d.lastVisit ?? null;

  const lines: string[] = [];
  lines.push(`<div style="font-weight:600;">${escapeHtml(heading)}</div>`);
  if (name) {
    lines.push(`<div style="opacity:0.85;font-size:11px;">${escapeHtml(name)}</div>`);
  }
  if (count !== null) {
    lines.push(
      `<div style="color:#fbbf24;margin-top:2px;">${count} ${escapeHtml(
        t("map:globe.flight", { count }),
      )}</div>`,
    );
  }
  if (lastVisit) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastVisit"),
      )}: ${escapeHtml(formatDate(lastVisit, locale))}</div>`,
    );
  }
  return lines.join("");
}

function renderPortHtml(
  d: PortDatum,
  heading: string,
  t: TFn,
  locale: string,
): string {
  const sub =
    d.shortLabel && d.shortLabel !== heading
      ? d.shortLabel
      : d.iata && d.iata !== heading
        ? d.iata
        : null;
  const visits = (d.visits ?? d.size) ?? null;
  const lastCall = d.lastVisit ?? null;

  const lines: string[] = [];
  lines.push(`<div style="font-weight:600;">⚓ ${escapeHtml(heading)}</div>`);
  if (sub) {
    lines.push(`<div style="opacity:0.85;font-size:11px;">${escapeHtml(sub)}</div>`);
  }
  if (visits !== null && visits > 0) {
    lines.push(
      `<div style="color:#7dd3fc;margin-top:2px;">${visits} ${escapeHtml(
        t("map:airportMarkers.visits"),
      )}</div>`,
    );
  }
  if (lastCall) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastCall"),
      )}: ${escapeHtml(formatDate(lastCall, locale))}</div>`,
    );
  }
  return lines.join("");
}
