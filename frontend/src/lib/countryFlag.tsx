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

// The languages a country field can plausibly arrive in. German and English
// are not enough: an imported saved-places list and a foreign booking mail both
// write the country in its OWN language. Measured on real lodging data, 65 of
// 279 houses showed no flag for exactly that reason — "España", "Italia",
// "Sverige", "Česko", "日本". Each locale here is one more language the field
// may be written in; the index is built once, lazily, and then cached.
const NAME_LOCALES = [
  "de", "en", "fr", "it", "es", "pt", "nl", "cs", "sk", "sl", "pl", "hu", "hr",
  "sv", "nb", "da", "fi", "et", "lv", "lt", "ro", "bg", "el", "tr", "ru", "uk",
  "ja", "zh", "ko", "ar", "th", "id", "ms", "vi", "he", "is", "ga", "mt", "sr",
  "lb", "ca", "eu", "gl", "cy", "sq", "mk", "bs", "af", "sw", "hi", "fa", "uz",
];

// Every ISO 639-1 language code. Not a curated selection — the point is that
// nobody has to have thought of the language the data happens to be in. Codes
// the runtime does not support fall back harmlessly (see `wide` below).
const ISO_639_1 =
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(
    " "
  );

// Names `Intl.DisplayNames` does not carry: former official forms and everyday
// short forms. Deliberately tiny — anything Intl already knows does not belong
// here, or the two sources drift apart.
const NAME_ALIASES: Record<string, string> = {
  "tschechische republik": "CZ",
  "czech republic": "CZ",
  "usa": "US",
  "u.s.a.": "US",
  "united states of america": "US",
  "großbritannien": "GB",
  "grossbritannien": "GB",
  "england": "GB",
  "südkorea": "KR",
  "suedkorea": "KR",
  "south korea": "KR",
  "north korea": "KP",
  "nordkorea": "KP",
};

/**
 * Reverse index (lowercased country name in ANY supported language → ISO code),
 * built lazily from `Intl.DisplayNames` — no hand-maintained name table, so it
 * recognises a name in whatever language it was written in. Built once and
 * cached; earlier locales win, so German and English stay authoritative where
 * two languages share a spelling.
 */
let narrowIndex: Map<string, string> | null = null;
let wideIndex: Map<string, string> | null = null;

function buildIndex(locales: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const locale of locales) {
    try {
      const dn = new Intl.DisplayNames([locale], { type: "region" });
      for (const cc of ISO_3166_1_ALPHA2) {
        const name = dn.of(cc);
        if (name && !index.has(name.toLowerCase())) index.set(name.toLowerCase(), cc);
      }
    } catch {
      // Unsupported locale — skip it, the remaining ones still resolve.
    }
  }
  for (const [name, cc] of Object.entries(NAME_ALIASES))
    if (!index.has(name)) index.set(name, cc);
  return index;
}

/**
 * Two indexes, and the wide one is only ever built on a miss.
 *
 * The UI is German and English, but the DATA is not: a country field arrives
 * in whatever language wrote it. So the resolver has to know every language,
 * while the interface stays bilingual — those are different questions and this
 * is where they part company.
 *
 * "Every language" cannot be enumerated: there is no API that lists the
 * locales a runtime supports (`Intl.supportedValuesOf` has no "locale" key,
 * and no "region" key either — do not reach for it). So the wide pass walks
 * the ISO 639-1 language codes and lets `Intl.DisplayNames` fall back for the
 * ones it does not carry; a fallback yields names already in the index, and
 * since the FIRST locale to claim a spelling keeps it, those cost nothing but
 * a lookup.
 *
 * Building it is ~180 locales x 249 codes, which is why it does not happen
 * until a name misses the narrow pass. Almost every field resolves on German,
 * English or a bare code and never pays for it.
 */
function narrow(): Map<string, string> {
  narrowIndex ??= buildIndex(NAME_LOCALES);
  return narrowIndex;
}
function wide(): Map<string, string> {
  wideIndex ??= buildIndex([...NAME_LOCALES, ...ISO_639_1]);
  return wideIndex;
}

/**
 * Resolves a free-text country field (as stored on `Lodging.country`) to an
 * ISO 3166-1 alpha-2 code for flag rendering. Handles every form the field can
 * hold: an already-valid code ("CH"), or a name in ANY language — the one the
 * app is displayed in, the one the country calls itself, or the one a foreign
 * booking mail happened to use. Returns `null` when nothing resolves — callers
 * must render nothing rather than guess (a wrong flag is worse than no flag).
 */
export function resolveCountryCode(country?: string | null): string | null {
  const direct = normCc(country);
  if (direct) return direct.toUpperCase();
  if (!country) return null;
  const needle = country.trim().toLowerCase();
  // An import that writes a missing value as text leaves the literal strings
  // "null"/"undefined" in the field. A flag for those would be invention.
  if (needle.length === 0 || needle === "null" || needle === "undefined") return null;

  // A multilingual country writes all its names into one field:
  // "Schweiz/Suisse/Svizzera/Svizra", "Suomi / Finland". Any part that resolves
  // identifies the country — they all name the same one.
  const kandidaten = [needle, ...needle.split(/[/|,;]| - /).map((p) => p.trim())].filter(Boolean);

  // The tiers are iterated as FUNCTIONS, not as an array of their results: a
  // `[narrow(), wide()]` literal would build the wide index on every call and
  // throw away the whole reason for splitting them.
  for (const tier of [narrow, wide]) {
    const index = tier();
    for (const part of kandidaten) {
      const code = index.get(part);
      if (code) return code;
    }
  }
  return null;
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
  const cc = normCc(country);
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
  const cc = normCc(country);
  if (!cc) return "";
  const w = Math.round(height * FLAG_ASPECT);
  return `<img src="${flagUrl(cc)}" alt="" aria-hidden="true" width="${w}" height="${height}" style="border-radius:2px;vertical-align:-2px;display:inline-block" />`;
}
