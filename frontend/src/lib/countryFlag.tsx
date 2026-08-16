// Country flags as real images from flagcdn.com.
//
// Emoji flags were the first attempt but Windows (Segoe UI Emoji) has no
// flag glyphs — Chrome renders 🇩🇪 as the letters "DE". flagcdn.com serves
// crisp SVG flags by ISO 3166-1 alpha-2 code with no API key; the app's CSP
// already allows `https:` images. Airports carry the ISO code; ports derive
// it from the UN/LOCODE prefix (DEHAM → DE).

import type { JSX } from "react";
import { useTranslation } from "../hooks/useTranslation";

const FLAG_ASPECT = 4 / 3;

// The resolver moved to `shared/geo/countryCode.ts` — the SERVER needs it too,
// to group by country instead of by whatever text an import wrote. Re-exported
// here so every existing import of this module keeps working.
export {
  countryFromUnlocode,
  countryName,
  resolveCountryCode,
} from "../shared/geo/countryCode";
import { resolveCountryCode, countryName } from "../shared/geo/countryCode";

// flagcdn serves LOWERCASE codes only — `/DE.svg` is a 404. Everything that
// builds a flag URL goes through here so the casing is settled in one place.
function flagUrl(cc: string): string {
  return `https://flagcdn.com/${cc.toLowerCase()}.svg`;
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
  const { i18n } = useTranslation();
  // Names as well as codes: callers hand this whatever the record holds.
  const cc = resolveCountryCode(country);
  if (!cc) return null;
  // The flag is the ONLY thing naming the country in the places it is used
  // most: the lodging table shows city OR country, so a row with a city has
  // its country nowhere but here. A picture of a flag is not a name — the
  // reader has to already know the flag, and a screen reader was told to
  // ignore it entirely. Both get the name now, in the interface language.
  const name = countryName(cc, i18n.language) || cc.toUpperCase();
  return (
    <img
      src={flagUrl(cc)}
      alt={name}
      title={name}
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
  // Names as well as codes, for the same reason `FlagImg` accepts them.
  const cc = resolveCountryCode(country);
  if (!cc) return "";
  const w = Math.round(height * FLAG_ASPECT);
  return `<img src="${flagUrl(cc)}" alt="" aria-hidden="true" width="${w}" height="${height}" style="border-radius:2px;vertical-align:-2px;display:inline-block" />`;
}
