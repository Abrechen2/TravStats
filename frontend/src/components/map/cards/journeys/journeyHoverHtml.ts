// Hover tooltips for journey routes, their stations, tours and trip stops
// (forgejo#323) — the flight route's tooltip (`arcHoverHtml`: both ends with
// their flags, then "N× geflogen · M× geplant" in the route colour), spoken
// for every other domain, with the domain's badge and a colour stripe so a
// train is told from a coach before a word is read.

import { escapeHtml } from "../../../../lib/escapeHtml";
import { flagImgHtml } from "../../../../lib/countryFlag";
import { formatDate as formatUserDate, formatTimeValueShown } from "../../../../lib/displayFormat";
import { formatNumber } from "../../../../lib/units";
import type { Rgb } from "../../../../lib/domainColor";
import { dayOf, type TimeValue } from "../../../../shared/time";
import type { JourneyRouteHover, JourneyRouteProfile, JourneyStopHover } from "./journeyLayerCards";
import type { JourneyDomain, JourneyEnd, TourCardDatum, TripStopCardDatum } from "./journeyTypes";
import { domainBadgeHtml, journeyIconName, rgbCss, tourIconName } from "./journeyIdentity";

type TFn = (key: string, options?: Record<string, unknown>) => string;

export interface JourneyHoverOptions {
  t: TFn;
  /** Flag height in px — 16 on a flat-map marker, as the airport tooltip uses. */
  flagHeight?: number;
}

/** The domain's "travelled" verb — a flight is flown, a car rented, the rest travelled. */
export function travelledLabel(domain: JourneyDomain, count: number, t: TFn): string {
  return domain === "flight"
    ? t("map:globe.timesFlown", { count })
    : t(`map:journey.times.${domain}`, { count });
}

/** "3× gefahren · 1× geplant", zero parts left out. */
export function tallyLabel(
  domain: JourneyDomain,
  travelled: number,
  planned: number,
  t: TFn
): string {
  const parts: string[] = [];
  if (travelled > 0) parts.push(travelledLabel(domain, travelled, t));
  if (planned > 0) parts.push(t("map:globe.timesPlanned", { count: planned }));
  return parts.join(" · ");
}

function stripe(color: Rgb, inner: string): string {
  return `<div style="border-left:3px solid ${rgbCss(color)};padding-left:8px;">${inner}</div>`;
}

function endLine(end: JourneyEnd, flagHeight: number): string {
  const code =
    end.code && end.code !== end.name
      ? `<span style="opacity:0.55;font-size:10px;font-family:monospace;">${escapeHtml(end.code)}</span>`
      : "";
  return `<div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:12.5px;padding:1px 0;">${flagImgHtml(end.country, flagHeight)}<span>${escapeHtml(end.name)}</span>${code}</div>`;
}

function tallyLine(
  d: { domain: JourneyDomain; travelled: number; planned: number; color: Rgb },
  t: TFn
): string {
  const label = tallyLabel(d.domain, d.travelled, d.planned, t);
  return label
    ? `<div style="color:${rgbCss(d.color)};font-weight:600;margin-top:4px;">${escapeHtml(label)}</div>`
    : "";
}

/** "12.04.2024" or "10.08.2024 → 11.08.2024" — the journey's day(s) on its places' clocks. */
function spanDay(departure: TimeValue | null, arrival: TimeValue | null): string {
  if (!departure) return "";
  const from = formatTimeValueShown(departure, { dateOnly: true });
  if (!arrival || dayOf(arrival) === dayOf(departure)) return from;
  if (Date.parse(arrival.utc) < Date.parse(departure.utc)) return from;
  return `${from} → ${formatTimeValueShown(arrival, { dateOnly: true })}`;
}

function factsLine(parts: string[]): string {
  return parts.length
    ? `<div data-testid="hover-profile" style="opacity:0.8;font-size:10.5px;margin-top:3px;">${escapeHtml(parts.join(" · "))}</div>`
    : "";
}

const attr = (name: string, value: string | number): string =>
  ` data-${name}="${escapeHtml(String(value))}"`;

/**
 * The slots `hoverEnrichment.ts` fills once the tooltip is drawn — the
 * operator's logo and a picture of the ship, car or train. Empty elements
 * until then, and for good on a miss: the tooltip never waits for them.
 */
function operatorSlot(domain: JourneyDomain, name: string | null): string {
  if (!name || domain === "flight") return "";
  return `<span data-hover-operator${attr("domain", domain)}${attr("name", name)} style="margin-left:auto;display:inline-flex"></span>`;
}

function subjectSlot(p: JourneyRouteProfile | undefined, t: TFn): string {
  if (!p?.subject) return "";
  return `<div data-hover-subject${attr("kind", p.subject.kind)}${attr("name", p.subject.name)}${attr("credit", t("map:journey.picture"))}></div>`;
}

export function journeyRouteHoverHtml(d: JourneyRouteHover, opts: JourneyHoverOptions): string {
  const { t, flagHeight = 16 } = opts;
  const p = d.profile;
  const head = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;opacity:0.85;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;">${domainBadgeHtml(journeyIconName(d.domain), d.color)}<span>${escapeHtml(t(`map:journey.domain.${d.domain}`))}</span>${operatorSlot(d.domain, p?.operator ?? null)}</div>`;
  const facts: string[] = [];
  if (p?.distanceKm != null) {
    const source = p.distanceSourceKeys.map((k) => t(k)).join(", ");
    facts.push(`${formatNumber(Math.round(p.distanceKm))} km${source ? ` (${source})` : ""}`);
  }
  if (p?.avgDurationMin != null) {
    facts.push(
      `Ø ${t("map:globe.pinned.durationHours", {
        h: Math.floor(p.avgDurationMin / 60),
        m: p.avgDurationMin % 60,
      })}`
    );
  }
  const last = p?.last ? spanDay(p.last.departure, p.last.arrival) : "";
  if (last) facts.push(`${t("map:journey.last")} ${last}`);
  return stripe(
    d.color,
    `${head}${endLine(d.dep, flagHeight)}${endLine(d.arr, flagHeight)}${tallyLine(d, t)}${factsLine(facts)}${subjectSlot(p, t)}`
  );
}

function stopSlot(d: JourneyStopHover, t: TFn): string {
  return `<div data-hover-stop${attr("domain", d.domain)}${attr("name", d.stop.name)}${attr("lat", d.stop.lat)}${attr("lon", d.stop.lon)}${attr("credit", t("openData:wikipedia.license"))}${attr("unavailable", t("map:journey.wikiUnavailable"))}></div>`;
}

export function journeyStopHoverHtml(d: JourneyStopHover, opts: JourneyHoverOptions): string {
  const { t, flagHeight = 16 } = opts;
  const head = `<div style="display:flex;align-items:center;gap:7px;">${domainBadgeHtml(journeyIconName(d.domain), d.color)}${endLine(d.stop, flagHeight)}</div>`;
  const kind = `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(t(`map:journey.stop.${d.domain}`))}</div>`;
  const facts: string[] = [];
  if (d.departures) facts.push(t(`map:journey.departures.${d.domain}`, { count: d.departures }));
  if (d.destinations?.length) {
    facts.push(
      `→ ${d.destinations.map((x) => `${x.name}${x.count > 1 ? ` ${x.count}×` : ""}`).join(", ")}`
    );
  }
  const lastLine = d.lastVisit
    ? factsLine([`${t("map:journey.lastHere")} ${spanDay(d.lastVisit, null)}`])
    : "";
  return stripe(
    d.color,
    `${head}${kind}${tallyLine(d, t)}${factsLine(facts)}${lastLine}${stopSlot(d, t)}`
  );
}

export function tourHoverHtml(d: TourCardDatum, opts: JourneyHoverOptions): string {
  const { t } = opts;
  const facts: string[] = [];
  if (d.mode && d.kind === "tour") facts.push(t(`trips:tours.mode.${d.mode}`));
  if (d.distanceKm !== null) facts.push(`${Math.round(d.distanceKm)} km`);
  if (d.ascentM !== null) facts.push(`↑ ${Math.round(d.ascentM)} m`);
  const head = `<div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:12.5px;">${domainBadgeHtml(tourIconName(d.kind, d.mode), d.color)}<span>${escapeHtml(d.name)}</span></div>`;
  const kind = `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(t(`map:journey.tourKind.${d.kind}`))}${d.tripName ? ` · ${escapeHtml(d.tripName)}` : ""}</div>`;
  const line = facts.length
    ? `<div style="color:${rgbCss(d.color)};font-weight:600;margin-top:4px;">${escapeHtml(facts.join(" · "))}</div>`
    : "";
  return stripe(d.color, `${head}${kind}${line}`);
}

export function tripStopHoverHtml(d: TripStopCardDatum): string {
  const day = (iso: string): string => formatUserDate(iso) || iso.slice(0, 10);
  const when =
    d.startDate && d.endDate && d.endDate !== d.startDate
      ? `${day(d.startDate)} – ${day(d.endDate)}`
      : d.startDate
        ? day(d.startDate)
        : "";
  return stripe(
    d.color,
    `<div style="font-weight:600;font-size:12.5px;">${escapeHtml(d.title)}</div>${when ? `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(when)}</div>` : ""}`
  );
}
