// Country flags as real images from flagcdn.com.
//
// Emoji flags were the first attempt but Windows (Segoe UI Emoji) has no
// flag glyphs — Chrome renders 🇩🇪 as the letters "DE". flagcdn.com serves
// crisp SVG flags by ISO 3166-1 alpha-2 code with no API key; the app's CSP
// already allows `https:` images. Airports carry the ISO code; ports derive
// it from the UN/LOCODE prefix (DEHAM → DE).

import type { JSX } from "react";

const FLAG_ASPECT = 4 / 3;

/** ISO 3166-1 alpha-2 → regional-indicator emoji ("DE" → 🇩🇪). */
export function countryFlag(iso2: string | null | undefined): string | null {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return null;
  const upper = iso2.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65)
  );
}

// Lowercase, validated 2-letter code — or null when it can't be a flag.
function normCc(code?: string | null): string | null {
  if (!code) return null;
  const cc = code.trim().toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? cc : null;
}

/** ISO country code from a UN/LOCODE (its first two letters). */
export function countryFromUnlocode(unlocode?: string | null): string | undefined {
  const cc = normCc(unlocode ? unlocode.slice(0, 2) : null);
  return cc ? cc.toUpperCase() : undefined;
}

// Localised country name from the ISO code, via the browser's built-in
// Intl.DisplayNames — no data table needed, follows the app language.
const nameCache = new Map<string, Intl.DisplayNames>();
export function countryName(code?: string | null, locale = "de"): string {
  const cc = normCc(code);
  if (!cc) return "";
  try {
    let dn = nameCache.get(locale);
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: "region" });
      nameCache.set(locale, dn);
    }
    return dn.of(cc.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

function flagUrl(cc: string): string {
  return `https://flagcdn.com/${cc}.svg`;
}

/** Inline flag image. Renders nothing for a missing/invalid country. */
export function FlagImg({
  country,
  height = 12,
  className,
}: {
  country?: string | null;
  height?: number;
  className?: string;
}): JSX.Element | null {
  const cc = normCc(country);
  if (!cc) return null;
  return (
    <img
      src={flagUrl(cc)}
      alt=""
      aria-hidden
      loading="lazy"
      width={Math.round(height * FLAG_ASPECT)}
      height={height}
      className={className}
      style={{
        borderRadius: 2,
        display: "inline-block",
        verticalAlign: "-2px",
        objectFit: "cover",
        flex: "none",
      }}
    />
  );
}

/** HTML string variant for the imperative globe tooltips. Empty when no flag. */
export function flagImgHtml(country?: string | null, height = 13): string {
  const cc = normCc(country);
  if (!cc) return "";
  const w = Math.round(height * FLAG_ASPECT);
  return `<img src="${flagUrl(cc)}" alt="" aria-hidden="true" width="${w}" height="${height}" style="border-radius:2px;vertical-align:-2px;display:inline-block" />`;
}
