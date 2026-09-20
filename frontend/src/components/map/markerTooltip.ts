import type { PickingInfo } from "@deck.gl/core";
import { escapeHtml } from "../../lib/escapeHtml";
import { flagImgHtml, countryName, resolveCountryCode } from "../../lib/countryFlag";
import {
  airportHoverHtml,
  arcHoverHtml,
  cruiseHoverHtml,
  portHoverHtml,
} from "./cards/hoverCardHtml";

// A flat-map marker sits closer to its neighbours than a globe marker does, so
// its tooltip wants a slightly smaller flag. That is the ONLY thing this file
// still decides about airport/port/route content — everything else comes from
// `cards/hoverCardHtml.ts`, which the globe draws too. Until 2026-09-20 there
// were two implementations of these four tooltips and they had already drifted.
const FLAT_FLAG_PX = 16;

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
  // Globe lodging pins (buildGlobeLayers.ts). GlobeView does not wire
  // `getTooltip` — it owns a React tooltip — but it calls this factory for
  // the same datum, so a hotel says the same thing on both maps instead of
  // growing a second renderer that can disagree with this one.
  "globe-lodging-pins",
]);
const PLACE_LAYER_IDS = new Set<string>([
  // Flat-map place pins (placePinsLayer.ts). All three are pickable and all
  // three are the same place, so all three answer: hovering the label and
  // getting nothing while the dot two pixels away answers is worse than no
  // tooltip at all.
  "place-pins",
  "place-pins-labels",
  "place-pins-symbols",
  // Globe place pins — see the note on the lodging set above.
  "globe-place-pins",
]);

interface PlaceDatum {
  readonly name?: string;
  readonly category?: string;
  readonly city?: string | null;
  /** Free text exactly as LodgingDatum.country is — resolved at render time. */
  readonly country?: string | null;
  readonly visitCount?: number;
  /** Logbook vs. wishlist. A wishlist entry has no visits to report. */
  readonly visited?: boolean;
}

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
  /** Flights on this route with status flown|historical. Optional — legacy
   *  datums without it fall back to the old "{{count}}x flown" label. */
  readonly flownCount?: number;
  /** Flights on this route with status scheduled. Optional, see flownCount. */
  readonly scheduledCount?: number;
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
      return { html: cruiseHoverHtml(datum.cruiseLine ?? "Cruise"), style: SURFACE_STYLE };
    }

    if (LODGING_LAYER_IDS.has(layerId)) {
      const datum = info.object as LodgingDatum | undefined | null;
      if (!datum?.name) return null;
      const html = renderLodgingHtml(datum, datum.name, t, locale);
      return { html, style: SURFACE_STYLE };
    }

    if (PLACE_LAYER_IDS.has(layerId)) {
      const datum = info.object as PlaceDatum | undefined | null;
      if (!datum?.name) return null;
      const html = renderPlaceHtml(datum, datum.name, t, locale);
      return { html, style: SURFACE_STYLE };
    }

    return null;
  };
}

function renderAirportHtml(d: AirportDatum, heading: string, t: TFn, locale: string): string {
  return airportHoverHtml(
    {
      // The flat map's heading may come from `name` when no IATA resolved;
      // pass it as the iata slot so the shared builder heads the card with it
      // and then skips the duplicate name line.
      iata: heading,
      icao: d.icao,
      name: d.name,
      city: d.city,
      country: d.country,
      count: d.count,
      lastVisit: d.lastVisit,
    },
    { t, locale, flagHeight: FLAT_FLAG_PX }
  );
}

function renderPortHtml(d: PortDatum, heading: string, t: TFn, locale: string): string {
  return portHoverHtml(
    {
      name: heading,
      code: d.shortLabel ?? d.iata,
      city: d.city,
      country: d.country,
      visits: d.visits ?? d.size,
      lastVisit: d.lastVisit,
    },
    { t, locale, flagHeight: FLAT_FLAG_PX }
  );
}

// Lodging domain rose (BRAND.md §3 / DOMAINS.lodging.color, shared/domains.ts)
// as a literal hex — this module renders plain HTML strings, not deck.gl
// props, so it can't reuse lodgingPinsLayer.ts's `hexToRgb`-derived tuple.
const LODGING_ACCENT_HEX = "#d4778f";
/** The POI domain hue, as BRAND.md §3 has it — same convention as the line above. */
const PLACE_ACCENT_HEX = "#5ec2b2";

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
  return arcHoverHtml(
    {
      departure: d.departure,
      arrival: d.arrival,
      count: d.count,
      color: d.sourceColor,
      flownCount: d.flownCount,
      scheduledCount: d.scheduledCount,
    },
    { t, flagHeight: FLAT_FLAG_PX }
  );
}

/**
 * A place card: what it is, where it is, and whether you have been.
 *
 * A wishlist entry reports its status instead of a visit count. "0 Besuche" is
 * technically true and reads as a failure; "Merkliste" is the same fact told
 * the way the user meant it.
 */
function renderPlaceHtml(d: PlaceDatum, heading: string, t: TFn, locale: string): string {
  const countryCode = resolveCountryCode(d.country);
  const where = [d.city, countryName(countryCode, locale)].filter(Boolean).join(", ");
  const visits = typeof d.visitCount === "number" && d.visitCount > 0 ? d.visitCount : null;

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagImgHtml(countryCode, 16)}<span>${escapeHtml(heading)}</span></div>`
  );
  if (where) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(where)}</div>`
    );
  }

  const tail: string[] = [];
  if (d.category) tail.push(t(`places:categories.${d.category}`));
  if (d.visited === false) tail.push(t("places:list.status.wishlist"));
  else if (visits !== null) tail.push(t("places:list.visitsCount", { count: visits }));

  if (tail.length > 0) {
    lines.push(
      `<div style="color:${PLACE_ACCENT_HEX};margin-top:2px;">${escapeHtml(tail.join(" · "))}</div>`
    );
  }
  return lines.join("");
}
