/**
 * Vessel-name normalisation shared by every resolver source. A ticket says
 * "MS Stena Germanica", Wikidata "Stena Germanica", AIS "STENA GERMANICA":
 * the prefix, the case, diacritics and punctuation carry no identity.
 */
const PREFIXES =
  /^(?:m\/?s|m\/?v|m\/?f|m\/?y|mt|mts|hsc|hss|ss|rms|ms|mv|mf|my|fs|ts|nb|sv|rv)\.?\s+/;

export function normaliseVesselName(raw: string | null | undefined): string {
  if (!raw) return "";
  const base = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\((?:ship|vessel|schiff|ferry|fähre|faehre)[^)]*\)\s*$/, "")
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base.replace(PREFIXES, "").trim();
}

/** Operator names compare loosely: "Stena Line" matches "Stena Line Scandinavia AB". */
export function operatorMatches(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const x = normaliseVesselName(a);
  const y = normaliseVesselName(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

export const isMmsi = (v: unknown): v is string => typeof v === "string" && /^\d{9}$/.test(v);
export const isImo = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);
