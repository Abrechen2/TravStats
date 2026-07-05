// Country-flag emoji from an ISO 3166-1 alpha-2 code.
//
// A flag emoji is two Regional Indicator Symbols (U+1F1E6…U+1F1FF), one per
// letter of the country code. No assets, no CDN — the OS font renders it.
// Airports carry the ISO code directly; ports derive it from the first two
// letters of their UN/LOCODE (DEHAM → DE, ITCVV → IT).

export function flagEmoji(code?: string | null): string {
  if (!code) return "";
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  const BASE = 0x1f1e6; // Regional Indicator Symbol Letter A
  return String.fromCodePoint(
    BASE + (cc.charCodeAt(0) - 65),
    BASE + (cc.charCodeAt(1) - 65)
  );
}

/** Flag for a port, taken from the ISO country prefix of its UN/LOCODE. */
export function flagFromUnlocode(unlocode?: string | null): string {
  if (!unlocode) return "";
  return flagEmoji(unlocode.slice(0, 2));
}
