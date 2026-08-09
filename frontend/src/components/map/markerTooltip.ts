import type { PickingInfo } from "@deck.gl/core";
import { escapeHtml } from "../../lib/escapeHtml";
import { flagImgHtml, countryName, resolveCountryCode } from "../../lib/countryFlag";

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
const ARC_LAYER_IDS = new Set<string>([
  // Flat-map flight-route arcs (routesLayer)
  "routes-arc",
  "routes-arc-scheduled",
  "routes-arc-upcoming",
  // …and the same routes in "flat" shape (#183, flatRoutesLayer). The datum
  // carries the same departure/arrival/count/sourceColor fields, so the route
  // card is identical whichever shape the user picked.
  "routes-path",
]);
const CRUISE_PATH_LAYER_IDS = new Set<string>(["cruise-arcs"]);
const LODGING_LAYER_IDS = new Set<string>([
  // Flat-map lodging pins (lodgingPinsLayer.ts) — dot + name label.
  "lodging-pins",
  "lodging-pins-labels",
]);

interface AirportDatum {
  readonly iata?: string;
  readonly icao?: string;
  readonly name?: string;
  readonly country?: string | null;
  readonly city?: string | null;
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
  readonly country?: string | null;
  readonly city?: string | null;
  /** Visits / cruise-stop count at this port. */
  readonly visits?: number;
  /** Globe carries the same number as `size` instead of `visits`. */
  readonly size?: number;
  /** ISO date of the most recent stop at this port. */
  readonly lastVisit?: string;
}

interface ArcTooltipDatum {
  readonly departure?: { iata?: string; name?: string; country?: string | null };
  readonly arrival?: { iata?: string; name?: string; country?: string | null };
  readonly count?: number;
  readonly sourceColor?: readonly [number, number, number, number];
}

interface CruisePathTooltipDatum {
  readonly cruiseLine?: string | null;
}

interface LodgingDatum {
  readonly name?: string;
  readonly city?: string | null;
  /**
   * Free text — an ISO code OR a full country name (`Lodging.country`).
   * Resolved via `resolveCountryCode` before it reaches `flagImgHtml`/
   * `countryName`, same as LodgingListPage/LodgingChainDetailPage.
   */
  readonly country?: string | null;
  /** Total stays recorded at this lodging. */
  readonly stayCount?: number;
  /** Total nights recorded at this lodging. */
  readonly nights?: number;
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
  locale: string
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

    if (ARC_LAYER_IDS.has(layerId)) {
      const datum = info.object as ArcTooltipDatum | undefined | null;
      if (!datum || !datum.departure || !datum.arrival) return null;
      const html = renderArcHtml(datum, t);
      return { html, style: SURFACE_STYLE };
    }

    if (CRUISE_PATH_LAYER_IDS.has(layerId)) {
      const datum = info.object as CruisePathTooltipDatum | undefined | null;
      if (!datum) return null;
      const html = `<div style="font-weight:600;">🚢 ${escapeHtml(datum.cruiseLine ?? "Cruise")}</div>`;
      return { html, style: SURFACE_STYLE };
    }

    if (LODGING_LAYER_IDS.has(layerId)) {
      const datum = info.object as LodgingDatum | undefined | null;
      if (!datum?.name) return null;
      const html = renderLodgingHtml(datum, datum.name, t, locale);
      return { html, style: SURFACE_STYLE };
    }

    return null;
  };
}

function renderAirportHtml(d: AirportDatum, heading: string, t: TFn, locale: string): string {
  const name = d.name && d.name !== heading ? d.name : null;
  const count = typeof d.count === "number" && d.count > 0 ? d.count : null;
  const lastVisit = d.lastVisit ?? null;
  const icaoPill = d.icao
    ? `<span style="font-size:10px;font-family:monospace;color:rgba(241,245,249,0.5);background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 5px;">${escapeHtml(d.icao)}</span>`
    : "";
  const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagImgHtml(d.country, 16)}<span>${escapeHtml(heading)}</span>${icaoPill}</div>`
  );
  if (name) {
    lines.push(
      `<div style="opacity:0.85;font-size:11px;margin-top:2px;">${escapeHtml(name)}</div>`
    );
  }
  if (place) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
    );
  }
  if (count !== null) {
    lines.push(
      `<div style="color:#fbbf24;margin-top:2px;">${count} ${escapeHtml(
        t("map:globe.flight", { count })
      )}</div>`
    );
  }
  if (lastVisit) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastVisit")
      )}: ${escapeHtml(formatDate(lastVisit, locale))}</div>`
    );
  }
  return lines.join("");
}

function renderPortHtml(d: PortDatum, heading: string, t: TFn, locale: string): string {
  const sub =
    d.shortLabel && d.shortLabel !== heading
      ? d.shortLabel
      : d.iata && d.iata !== heading
        ? d.iata
        : null;
  const visits = d.visits ?? d.size ?? null;
  const lastCall = d.lastVisit ?? null;
  const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");
  const flagOrAnchor = d.country ? flagImgHtml(d.country, 16) : "⚓";

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagOrAnchor}<span>${escapeHtml(heading)}</span></div>`
  );
  if (sub) {
    lines.push(`<div style="opacity:0.85;font-size:11px;margin-top:2px;">${escapeHtml(sub)}</div>`);
  }
  if (place) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
    );
  }
  if (visits !== null && visits > 0) {
    lines.push(
      `<div style="color:#7dd3fc;margin-top:2px;">${visits} ${escapeHtml(
        t("map:airportMarkers.visits")
      )}</div>`
    );
  }
  if (lastCall) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastCall")
      )}: ${escapeHtml(formatDate(lastCall, locale))}</div>`
    );
  }
  return lines.join("");
}

// Lodging domain rose (BRAND.md §3 / DOMAINS.lodging.color, shared/domains.ts)
// as a literal hex — this module renders plain HTML strings, not deck.gl
// props, so it can't reuse lodgingPinsLayer.ts's `hexToRgb`-derived tuple.
const LODGING_ACCENT_HEX = "#d4778f";

function renderLodgingHtml(d: LodgingDatum, heading: string, t: TFn, locale: string): string {
  // `d.country` is free text (an ISO code or a full country name) — resolve
  // it to an ISO code before handing it to flagImgHtml/countryName, which
  // both require a strict 2-letter code and silently render nothing
  // otherwise (see LodgingPinDatum's doc comment in lodgingPinsLayer.ts).
  const countryCode = resolveCountryCode(d.country);
  const place = [d.city, countryName(countryCode, locale)].filter(Boolean).join(", ");
  const stayCount = typeof d.stayCount === "number" && d.stayCount > 0 ? d.stayCount : null;
  const nights = typeof d.nights === "number" && d.nights > 0 ? d.nights : null;

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagImgHtml(countryCode, 16)}<span>${escapeHtml(heading)}</span></div>`
  );
  if (place) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
    );
  }
  if (stayCount !== null || nights !== null) {
    const parts: string[] = [];
    if (stayCount !== null) parts.push(t("lodging:field.staysCount", { count: stayCount }));
    if (nights !== null) parts.push(t("lodging:field.nightsCount", { count: nights }));
    lines.push(
      `<div style="color:${LODGING_ACCENT_HEX};margin-top:2px;">${escapeHtml(parts.join(" · "))}</div>`
    );
  }
  return lines.join("");
}

function renderArcHtml(d: ArcTooltipDatum, t: TFn): string {
  const epLine = (ep?: { iata?: string; name?: string; country?: string | null }): string =>
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;padding:1px 0;">
      ${flagImgHtml(ep?.country, 16)}<span>${escapeHtml(ep?.iata ?? "?")}</span>
      <span style="opacity:0.6;font-weight:500;font-size:11px;">${escapeHtml(ep?.name ?? "")}</span>
    </div>`;
  const count = d.count ?? 0;
  const [r, g, b] = d.sourceColor ?? [241, 245, 249, 255];
  return `
    ${epLine(d.departure)}
    ${epLine(d.arrival)}
    <div style="color:rgb(${r},${g},${b});font-weight:600;margin-top:4px;">
      ${escapeHtml(t("map:globe.timesFlown", { count }))}
    </div>`;
}
