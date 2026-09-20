// The card's own furniture: the glass surface, the three tiers (heading →
// hero stat → metadata grid), the action row and the formatters.
//
// Split out of `PinnedCard.tsx` when the card became shared map chrome
// (owner ruling 2026-09-20), so the card file stays about WHAT each selection
// says and this one about how any of it is drawn.

import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { countryName } from "../../../lib/countryFlag";
import { formatDate as formatUserDate } from "../../../lib/displayFormat";
import { rgb, tokens } from "../../../theme/tokens";

export type TFn = ReturnType<typeof useTranslation>["t"];

// The accent, at the two alphas the card needs. Derived rather than written
// out, so the primary action follows the theme instead of carrying a colour
// nobody decided (design wardens, DESIGN_SYSTEM.md §10).
const [AR, AG, AB] = rgb(tokens.color.accent);
const ACCENT_FILL = `rgba(${AR},${AG},${AB},0.18)`;
const ACCENT_EDGE = `rgba(${AR},${AG},${AB},0.45)`;

/**
 * The card floats over live map imagery, so it carries its own dark glass
 * rather than a theme surface — a translucent `--bg-surface` over a bright
 * basemap is unreadable. The ink and the border ARE theme tokens.
 */
export const SURFACE: React.CSSProperties = {
  background: "rgba(13, 17, 23, 0.92)",
  backdropFilter: "blur(12px)",
  border: `1px solid ${tokens.color.border}`,
  color: tokens.color.text,
  fontFamily: "'Inter', sans-serif",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  minWidth: 240,
  maxWidth: 300,
};

export const LABEL_STYLE: React.CSSProperties = {
  color: tokens.color.faint,
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

export const VALUE_STYLE: React.CSSProperties = {
  color: tokens.color.text,
  fontSize: 11,
};

export function SubHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mb-2 text-[11px] opacity-85">{children}</div>;
}

export function Hero({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}): JSX.Element {
  return (
    <div className="mb-3 text-[13px]" style={{ color, fontWeight: 700 }}>
      {children}
    </div>
  );
}

export function Grid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="space-y-1.5">{children}</div>;
}

export function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={VALUE_STYLE} className="text-right">
        {value}
      </span>
    </div>
  );
}

export function IcaoPill({ icao }: { icao?: string }): JSX.Element | null {
  if (!icao) return null;
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
      style={{ color: tokens.color.faint, background: "rgba(255,255,255,0.06)" }}
    >
      {icao}
    </span>
  );
}

/** "City, Country" line — country name derived from the ISO code. */
export function Place({
  city,
  country,
  locale,
}: {
  city?: string | null;
  country?: string | null;
  locale: string;
}): JSX.Element | null {
  const parts = [city, countryName(country, locale)].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return (
    <div className="mb-2 text-[11px]" style={{ color: tokens.color.faint }}>
      {parts.join(", ")}
    </div>
  );
}

/**
 * One action row for both maps. The globe card had a single CTA and the flat
 * map's tooltips had "Bearbeiten"; the ruling folded them into one card, so
 * the card carries both and each renderer decides which handlers it passes.
 */
export function Actions({
  primary,
  secondary,
}: {
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}): JSX.Element | null {
  if (!primary && !secondary) return null;
  return (
    <div className="mt-3 flex gap-2">
      {primary && (
        <button
          type="button"
          onClick={primary.onClick}
          className="flex-1 cursor-pointer rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors"
          style={{
            background: ACCENT_FILL,
            border: `1px solid ${ACCENT_EDGE}`,
            color: tokens.color.accentHover,
          }}
        >
          {primary.label}
        </button>
      )}
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: `1px solid ${tokens.color.border}`,
            color: tokens.color.text,
          }}
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}

// ─── Formatters ───────────────────────────────────────────────────

export function formatKm(km: number, locale: string): string {
  return `${formatKmNumber(km, locale)} km`;
}

/**
 * The thousands separator follows the READER.
 *
 * It was `de-DE`, from when this helper belonged to the globe card alone and
 * the globe was a German-first surface. It governs the flat map's card too
 * now, where `MapTooltip` used the reader's locale — and to an English reader
 * "3.931 km" is not 3931 but 3.9.
 */
export function formatKmNumber(km: number, locale: string): string {
  if (km < 1000) return Math.round(km).toString();
  return Math.round(km).toLocaleString(locale);
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** In the user's date format (Settings → Display); the locale no longer decides. */
export function formatDate(iso: string, _locale: string): string {
  return formatUserDate(iso) || iso.slice(0, 10);
}

export function formatDuration(minutes: number, t: TFn): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return t("map:globe.pinned.durationHours", { h, m });
}
