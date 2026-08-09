// Country flags as real images from flagcdn.com.
//
// Emoji flags were the first attempt but Windows (Segoe UI Emoji) has no
// flag glyphs — Chrome renders 🇩🇪 as the letters "DE". flagcdn.com serves
// crisp SVG flags by ISO 3166-1 alpha-2 code with no API key; the app's CSP
// already allows `https:` images. Airports carry the ISO code; ports derive
// it from the UN/LOCODE prefix (DEHAM → DE).

import type { JSX } from "react";

const FLAG_ASPECT = 4 / 3;

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

// Every ISO 3166-1 alpha-2 code — plain data, not an opinionated subset, so
// `resolveCountryCode` below can recognise a free-text country name in any
// language `Intl.DisplayNames` supports rather than just a hand-picked list
// of "common" countries.
const ISO_3166_1_ALPHA2 =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " "
  );

/**
 * Reverse index (lowercased localized country name → ISO code), built lazily
 * per locale from `Intl.DisplayNames` — no hand-maintained name table, so it
 * recognises a name in whatever language the user typed it in as long as
 * `Intl` knows that locale. Cached per locale since building it iterates the
 * full code list once.
 */
const nameToCodeCache = new Map<string, Map<string, string>>();
function nameToCodeIndex(locale: string): Map<string, string> {
  let index = nameToCodeCache.get(locale);
  if (index) return index;
  index = new Map();
  try {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    for (const cc of ISO_3166_1_ALPHA2) {
      const name = dn.of(cc);
      if (name) index.set(name.toLowerCase(), cc);
    }
  } catch {
    // Unsupported locale — leave the index empty, caller falls back gracefully.
  }
  nameToCodeCache.set(locale, index);
  return index;
}

/**
 * Resolves a free-text country field (as stored on `Lodging.country`) to an
 * ISO 3166-1 alpha-2 code for flag rendering. Handles both forms the field
 * can hold: an already-valid code ("CH") or a full name in German or English
 * ("Switzerland" / "Schweiz"). Returns `null` when neither resolves — callers
 * must render nothing rather than guess (a wrong flag is worse than no flag).
 */
export function resolveCountryCode(country?: string | null): string | null {
  const direct = normCc(country);
  if (direct) return direct.toUpperCase();
  if (!country) return null;
  const needle = country.trim().toLowerCase();
  if (needle.length === 0) return null;
  return nameToCodeIndex("de").get(needle) ?? nameToCodeIndex("en").get(needle) ?? null;
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
