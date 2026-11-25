/**
 * Identity and search normalisation for companion names.
 *
 * canonicalize is the IDENTITY rule: two names that canonicalize alike are the
 * same person. It deliberately does NOT fold diacritics — "José" and "Jose" are
 * different people, and merging them cannot be undone once rows are linked.
 *
 * searchable is a SEARCH aid only. It folds diacritics so typing "Muller"
 * finds "Müller". It is never unique and never decides identity.
 */

/** NFKC + trim + collapse inner whitespace + lowercase. Accents preserved. */
export function canonicalizeCompanionName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The canonical form with combining marks stripped. Search only. */
export function searchableCompanionName(raw: string): string {
  return canonicalizeCompanionName(raw)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * The key two names share when they MAY be one person (one person, one companion, 2026-11-24):
 * case, diacritics and word order folded — "Wittke, Norbert", "norbert wittke" and "Nörbert
 * Wittke" all meet. A QUESTION aid only: it decides what the owner is asked ("Ist das …?"),
 * never a link by itself.
 */
export function personMatchKey(raw: string): string {
  return searchableCompanionName(raw)
    .split(/[\s,.;]+/u)
    .filter((part) => part.length > 0)
    .sort()
    .join(" ");
}
