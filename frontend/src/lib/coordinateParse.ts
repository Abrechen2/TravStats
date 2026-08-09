/**
 * Free-text coordinate-pair parser — powers the "paste coordinates" fast
 * path in `LocationInput` (Task 3). Pure function, no I/O.
 *
 * Accepted forms (see the plan's "Coordinate paste — viele Möglichkeiten"
 * section for the authoritative contract):
 *   - decimal pairs separated by comma, semicolon, or whitespace
 *     ("47.3769, 8.5417", "47.3769 8.5417", "47.3769; 8.5417")
 *   - the same, wrapped in parentheses or square brackets
 *   - Google Maps URL forms: "…/@lat,lon,12z…" and "…?q=lat,lon…"
 *   - hemisphere letters N/S/E/W, before OR after each number, in either
 *     axis order (N/S always maps to latitude, E/W always to longitude
 *     regardless of which one appears first); S/W negate
 *
 * Deliberately NOT implemented (documented follow-up, spec §4 note):
 *   - DMS notation ("47°22'37"N") — rejected via the degree-symbol check
 *   - Plus Codes ("8FVC9G8F+6X") — never match any accepted shape below
 *
 * Range check: lat ∈ [-90,90], lon ∈ [-180,180]. NEVER auto-swaps a pair
 * that fails range for one axis but would pass for the other — that would
 * be guessing at user intent. An out-of-range component means the whole
 * input is rejected (`null`), full stop.
 */

export interface ParsedCoordinate {
  lat: number;
  lon: number;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

// Google Maps "@lat,lon,zoom" — e.g. ".../@47.3769,8.5417,12z/...".
const GOOGLE_MAPS_AT = new RegExp(`@(${NUM}),(${NUM})`);
// Google Maps "?q=lat,lon" or "&q=lat,lon".
const GOOGLE_MAPS_Q = new RegExp(`[?&]q=(${NUM}),(${NUM})`);

// Plain pair, no hemisphere letters: "<num> <sep> <num>", sep = , ; or whitespace.
const PLAIN_PAIR = new RegExp(`^(${NUM})\\s*[,;\\s]\\s*(${NUM})$`);

// Hemisphere letter AFTER its number, axis determined by the letter itself
// (not by position), so "47.3769 N, 8.5417 E" and "8.5417 E, 47.3769 N" both
// resolve correctly.
const TRAILING_HEMI = new RegExp(
  `^(?:(${NUM})\\s*([NSns])|(${NUM})\\s*([EWew]))\\s*[,;]?\\s*` +
    `(?:(${NUM})\\s*([NSns])|(${NUM})\\s*([EWew]))$`
);

// Hemisphere letter BEFORE its number.
const LEADING_HEMI = new RegExp(
  `^(?:([NSns])\\s*(${NUM})|([EWew])\\s*(${NUM}))\\s*[,;]?\\s*` +
    `(?:([NSns])\\s*(${NUM})|([EWew])\\s*(${NUM}))$`
);

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLon(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function finalize(lat: number, lon: number): ParsedCoordinate | null {
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  return { lat, lon };
}

function signFor(letter: string): 1 | -1 {
  const upper = letter.toUpperCase();
  return upper === "S" || upper === "W" ? -1 : 1;
}

/**
 * Resolves the two axis-tagged alternation branches (lat pattern vs lon
 * pattern) shared by both hemisphere regexes above into a lat/lon pair.
 * Exactly one of each pair of groups must be defined — e.g. if the first
 * component matched as N/S (lat), the second component MUST have matched as
 * E/W (lon); two lats or two lons is not a valid coordinate pair.
 */
function resolveHemisphereGroups(
  latLetter1: string | undefined,
  latNum1: string | undefined,
  lonLetter1: string | undefined,
  lonNum1: string | undefined,
  latLetter2: string | undefined,
  latNum2: string | undefined,
  lonLetter2: string | undefined,
  lonNum2: string | undefined
): ParsedCoordinate | null {
  const latLetter = latLetter1 ?? latLetter2;
  const latNumStr = latNum1 ?? latNum2;
  const lonLetter = lonLetter1 ?? lonLetter2;
  const lonNumStr = lonNum1 ?? lonNum2;

  if (latLetter === undefined || latNumStr === undefined) return null;
  if (lonLetter === undefined || lonNumStr === undefined) return null;

  const lat = signFor(latLetter) * Math.abs(Number(latNumStr));
  const lon = signFor(lonLetter) * Math.abs(Number(lonNumStr));
  return finalize(lat, lon);
}

function tryGoogleMapsUrl(text: string): ParsedCoordinate | null {
  const atMatch = GOOGLE_MAPS_AT.exec(text);
  if (atMatch) {
    return finalize(Number(atMatch[1]), Number(atMatch[2]));
  }
  const qMatch = GOOGLE_MAPS_Q.exec(text);
  if (qMatch) {
    return finalize(Number(qMatch[1]), Number(qMatch[2]));
  }
  return null;
}

function tryTrailingHemisphere(text: string): ParsedCoordinate | null {
  const match = TRAILING_HEMI.exec(text);
  if (!match) return null;
  const [, latNum1, latLetter1, lonNum1, lonLetter1, latNum2, latLetter2, lonNum2, lonLetter2] =
    match;
  return resolveHemisphereGroups(
    latLetter1,
    latNum1,
    lonLetter1,
    lonNum1,
    latLetter2,
    latNum2,
    lonLetter2,
    lonNum2
  );
}

function tryLeadingHemisphere(text: string): ParsedCoordinate | null {
  const match = LEADING_HEMI.exec(text);
  if (!match) return null;
  const [, latLetter1, latNum1, lonLetter1, lonNum1, latLetter2, latNum2, lonLetter2, lonNum2] =
    match;
  return resolveHemisphereGroups(
    latLetter1,
    latNum1,
    lonLetter1,
    lonNum1,
    latLetter2,
    latNum2,
    lonLetter2,
    lonNum2
  );
}

function tryPlainPair(text: string): ParsedCoordinate | null {
  const match = PLAIN_PAIR.exec(text);
  if (!match) return null;
  return finalize(Number(match[1]), Number(match[2]));
}

/**
 * Parses free-text input into a `{lat, lon}` pair, or `null` if the text
 * isn't one of the accepted forms (see module docs). Never throws.
 */
export function parseCoordinateInput(text: string): ParsedCoordinate | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // DMS uses a degree symbol ("47°22'37""); decimal-degree input never does.
  // Reject upfront rather than let the digit-only patterns below accidentally
  // pick a partial match out of a DMS string.
  if (trimmed.includes("°")) return null;

  const fromUrl = tryGoogleMapsUrl(trimmed);
  if (fromUrl) return fromUrl;

  // Strip wrapping parentheses/brackets (anywhere, not just at the ends —
  // "(47.3769, 8.5417)" and stray characters are both handled by just
  // removing the bracket characters and re-trimming).
  const stripped = trimmed.replace(/[()[\]]/g, "").trim();
  if (stripped.length === 0) return null;

  return (
    tryLeadingHemisphere(stripped) ?? tryTrailingHemisphere(stripped) ?? tryPlainPair(stripped)
  );
}

export default parseCoordinateInput;
