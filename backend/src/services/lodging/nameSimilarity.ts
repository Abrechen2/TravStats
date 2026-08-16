/**
 * Deciding whether two hotel names could name one house.
 *
 * The import matcher keys on the whole name, so a booking mail and a
 * saved-places export produce two records for one building whenever they write
 * it differently. Measured on the owner's library: 25 such pairs among 293
 * houses. One was created live while he was testing:
 *
 *   "Emirates Palace Mandarin Oriental"   saved places, Abu Dhabi, pinned
 *   "Emirates Palace, Abu Dhabi"          booking mail, no pin, city "F869C3J"
 *
 * Neither name contains the other, so a containment rule misses it. What they
 * share is two distinctive words — that is the signal this module reports.
 *
 * It reports; it does not decide. "Hotel Rose" names a real house in
 * Bietigheim-Bissingen AND one in Portland, so the caller must combine the
 * overlap with WHERE the two sit — same city, nearby pin, or at least the same
 * country — before treating them as one.
 */

/**
 * Words that decorate a hotel name rather than identify it, plus the company
 * suffixes a register demands and a booking mail never prints.
 *
 * `inn` is deliberately ABSENT: it identifies in "Park Inn" and "Holiday Inn".
 */
const GENERIC_TOKENS = new Set([
  "hotel",
  "hotels",
  "restaurant",
  "gasthof",
  "gasthaus",
  "landgasthof",
  "pension",
  "resort",
  "spa",
  "motel",
  "hostel",
  "camping",
  "campingplatz",
  "haus",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "am",
  "an",
  "im",
  "in",
  "zum",
  "zur",
  "bei",
  "the",
  "by",
  "and",
  "und",
  "of",
  "de",
  "la",
  "le",
  "gmbh",
  "kg",
  "ag",
  "co",
  "inh",
  "sarl",
  "srl",
  "bv",
  "ltd",
  "plc",
  "sa",
  "spa2",
]);

/** ä/ö/ü/ß folded the German way, so "Nordhäuser" and "Nordhaeuser" meet. */
function foldGerman(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function tokenize(name: string): string[] {
  return foldGerman(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Tokens that carry identity, keeping first-seen order and dropping repeats. */
function strictTokens(name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(name)) {
    if (GENERIC_TOKENS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * The identifying words of a name.
 *
 * When a name consists of nothing BUT decoration ("Hotel"), the decoration is
 * returned rather than an empty list — an empty list would compare equal to
 * every other empty list and fold unrelated houses together.
 */
export function significantTokens(name: string): string[] {
  const strict = strictTokens(name);
  if (strict.length > 0) return strict;

  const seen = new Set<string>();
  return tokenize(name).filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
}

/**
 * Identifying words the two names have in common, in the first name's order.
 *
 * Computed on the STRICT tokens on purpose: two names made only of decoration
 * ("Hotel Restaurant" and "Restaurant Hotel") share nothing that identifies a
 * house, and reporting an overlap there would fold every such name into one.
 */
export function sharedSignificantTokens(nameA: string, nameB: string): string[] {
  const other = new Set(strictTokens(nameB));
  return strictTokens(nameA).filter((token) => other.has(token));
}
