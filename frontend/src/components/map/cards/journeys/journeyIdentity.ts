// What makes a journey card look like ITS domain (owner, 2026-10-20: "schöne
// Designs passend zu Domains, ähnlich wie die Flaggen").
//
// The flags lifted the airport cards because they say "where" at a glance; the
// domain's own line icon in its own colour says "how". Both come from what the
// app already draws — the Lucide icons of the logbook tabs (`DOMAIN_ICON`) and
// the colour the caller resolved from the colour store — so a card can never
// show a hue or a glyph the rest of the app does not.

import { escapeHtml } from "../../../../lib/escapeHtml";
import { DOMAIN_ICON } from "../../../ui/domainIcons";
import { LUCIDE, type IconName } from "../../../ui/icons/lucide";
import type { Rgb } from "../../../../lib/domainColor";
import type { JourneyDomain } from "./journeyTypes";

/** The icon of a tour by its means of transport — the mode, not the hue, tells them apart. */
const TOUR_MODE_ICON: Record<string, IconName> = {
  road: "car",
  ferry: "ship",
  rail: "train-front",
  foot: "route",
  bike: "bike",
};

export function journeyIconName(domain: JourneyDomain): IconName {
  return DOMAIN_ICON[domain];
}

export function tourIconName(kind: "tour" | "roadtrip", mode: string | null): IconName {
  if (kind === "roadtrip") return DOMAIN_ICON.roadtrip;
  return (mode && TOUR_MODE_ICON[mode]) || "route";
}

export function rgbCss([r, g, b]: Rgb, alpha = 1): string {
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/**
 * A Lucide icon as an SVG string, for the hover tooltip — which is HTML, not
 * React (`HoverTooltip.tsx`: hover fires at 60–120 Hz). Built from the same
 * vendored path data `Icon` renders, so the glyph is identical in both.
 */
export function lucideSvgHtml(name: IconName, size: number, color: string): string {
  const parts = LUCIDE[name]
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-domain-icon="${name}" style="flex-shrink:0">${parts}</svg>`;
}

/**
 * The badge a tooltip leads with: the domain's icon on a tint of its colour.
 * The card draws the same badge in React (`DomainBadge`).
 */
export function domainBadgeHtml(icon: IconName, color: Rgb): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;background:${rgbCss(color, 0.18)};border:1px solid ${rgbCss(color, 0.45)}">${lucideSvgHtml(icon, 13, rgbCss(color))}</span>`;
}
