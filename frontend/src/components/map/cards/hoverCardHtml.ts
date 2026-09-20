// Hover-tooltip content, as the globe draws it.
//
// These four builders were inline in `GlobeView.tsx` and had a near-twin each
// in `markerTooltip.ts` — two implementations of the same four tooltips that
// had already drifted (flag heights, the fallback code, whether the visit
// count shows at all). The owner's 2026-09-20 ruling made the globe the
// reference for map chrome, so the globe's versions moved here and
// `markerTooltip.ts` now calls them instead of keeping its own.
//
// HTML strings rather than React: the tooltip is fed to `HoverTooltip`'s
// imperative handle (and to deck.gl's `getTooltip` on the surfaces that still
// use it), both of which want markup, and hover fires at 60–120 Hz.
//
// Where the two surfaces genuinely differ, the difference is a PARAMETER the
// caller passes, not a second builder: the globe draws slightly larger flags
// than a flat-map marker wants, and the flat map has a visit count for a port
// that the globe's port datum does not carry.

import { escapeHtml } from "../../../lib/escapeHtml";
import { countryName, flagImgHtml } from "../../../lib/countryFlag";
import { formatDate as formatUserDate } from "../../../lib/displayFormat";
import { tokens } from "../../../theme/tokens";
import type { CardEndpoint } from "./pinnedTypes";

type TFn = (key: string, options?: Record<string, unknown>) => string;

export interface HoverHtmlOptions {
  t: TFn;
  locale?: string;
  /** Flag height in px. The globe passes 18–19, a flat-map marker 16. */
  flagHeight?: number;
}

/** In the user's date format (Settings → Display); the locale no longer decides. */
function formatDate(iso: string): string {
  return formatUserDate(iso) || iso.slice(0, 10);
}

function placeLine(
  city: string | null | undefined,
  country: string | null | undefined,
  locale: string
): string {
  const place = [city, countryName(country, locale)].filter(Boolean).join(", ");
  if (!place) return "";
  return `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`;
}

function datedLine(label: string, iso: string): string {
  return `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(label)}: ${escapeHtml(formatDate(iso))}</div>`;
}

// ─── Airport ──────────────────────────────────────────────────────

export interface AirportHoverDatum {
  iata?: string;
  icao?: string;
  name?: string;
  city?: string | null;
  country?: string | null;
  /** Flights touching this airport. Omitted or 0 → the line is left out. */
  count?: number;
  lastVisit?: string | null;
}

export function airportHoverHtml(d: AirportHoverDatum, opts: HoverHtmlOptions): string {
  const { t, locale = "de", flagHeight = 19 } = opts;
  const heading = d.iata ?? d.name ?? "";
  if (!heading) return "";
  const icaoPill = d.icao
    ? `<span style="font-size:10px;font-family:monospace;color:${tokens.color.faint};background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 5px;">${escapeHtml(d.icao)}</span>`
    : "";
  // The name line is skipped when it would just repeat the heading — on the
  // globe the heading is the IATA and the name is the airport, so it always
  // shows there; on a flat-map label layer the two can be the same string.
  const nameLine =
    d.name && d.name !== heading
      ? `<div style="opacity:0.88;font-size:11.5px;margin-top:3px;">${escapeHtml(d.name)}</div>`
      : "";
  const count = typeof d.count === "number" && d.count > 0 ? d.count : null;
  const countLine =
    count !== null
      ? `<div style="color:${tokens.domainColor.flight};margin-top:4px;">${count} ${escapeHtml(t("map:globe.flight", { count }))}</div>`
      : "";
  return `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;">${flagImgHtml(d.country, flagHeight)}<span>${escapeHtml(heading)}</span>${icaoPill}</div>${nameLine}${placeLine(d.city, d.country, locale)}${countLine}${d.lastVisit ? datedLine(t("map:tooltip.lastVisit"), d.lastVisit) : ""}`;
}

// ─── Port ─────────────────────────────────────────────────────────

export interface PortHoverDatum {
  name?: string;
  /** UN/LOCODE or short label — shown under the name when it differs. */
  code?: string | null;
  city?: string | null;
  country?: string | null;
  /** Cruise stops at this port. Omitted or 0 → the line is left out. */
  visits?: number;
  lastVisit?: string | null;
}

export function portHoverHtml(d: PortHoverDatum, opts: HoverHtmlOptions): string {
  const { t, locale = "de", flagHeight = 19 } = opts;
  const heading = d.name ?? d.code ?? "";
  if (!heading) return "";
  const flag = d.country ? flagImgHtml(d.country, flagHeight) : "⚓";
  const codeLine =
    d.code && d.code !== heading
      ? `<div style="opacity:0.55;font-size:10px;font-family:monospace;margin-top:2px;">${escapeHtml(d.code)}</div>`
      : "";
  const visits = typeof d.visits === "number" && d.visits > 0 ? d.visits : null;
  const visitsLine =
    visits !== null
      ? `<div style="color:${tokens.domainColor.cruise};margin-top:2px;">${visits} ${escapeHtml(t("map:airportMarkers.visits"))}</div>`
      : "";
  return `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;">${flag}<span>${escapeHtml(heading)}</span></div>${placeLine(d.city, d.country, locale)}${codeLine}${visitsLine}${d.lastVisit ? datedLine(t("map:tooltip.lastCall"), d.lastVisit) : ""}`;
}

// ─── Route arc ────────────────────────────────────────────────────

export interface ArcHoverDatum {
  departure?: CardEndpoint;
  arrival?: CardEndpoint;
  count?: number;
  color?: readonly [number, number, number] | readonly [number, number, number, number];
  /** Flights on this route with status flown|historical. */
  flownCount?: number;
  /** Flights on this route with status scheduled. */
  scheduledCount?: number;
}

export function arcHoverHtml(d: ArcHoverDatum, opts: Omit<HoverHtmlOptions, "locale">): string {
  const { t, flagHeight = 18 } = opts;
  const epLine = (ep?: CardEndpoint): string =>
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;padding:1px 0;">
      ${flagImgHtml(ep?.country, flagHeight)}<span>${escapeHtml(ep?.iata ?? "?")}</span>
      <span style="opacity:0.6;font-weight:500;font-size:11px;">${escapeHtml(ep?.name ?? "")}</span>
    </div>`;
  const [r, g, b] = d.color ?? [241, 245, 249];
  // Two-part label: flown first, then scheduled, zero-count parts omitted.
  // Falls back to the flown-only label for a cancelled-only route where both
  // counts are 0 despite count > 0 (accepted pre-existing cancelled
  // semantic), and for a legacy datum that carries neither count.
  const flown = d.flownCount;
  const scheduled = d.scheduledCount;
  let label: string;
  if (typeof flown === "number" && typeof scheduled === "number") {
    const parts: string[] = [];
    if (flown > 0) parts.push(t("map:globe.timesFlown", { count: flown }));
    if (scheduled > 0) parts.push(t("map:globe.timesPlanned", { count: scheduled }));
    label = parts.join(" · ") || t("map:globe.timesFlown", { count: d.count ?? 0 });
  } else {
    label = t("map:globe.timesFlown", { count: d.count ?? 0 });
  }
  return `
    ${epLine(d.departure)}
    ${epLine(d.arrival)}
    <div style="color:rgb(${r},${g},${b});font-weight:600;margin-top:4px;">
      ${escapeHtml(label)}
    </div>`;
}

// ─── Cruise path ──────────────────────────────────────────────────

export function cruiseHoverHtml(label: string): string {
  return `<div style="font-weight:600;">🚢 ${escapeHtml(label)}</div>`;
}
