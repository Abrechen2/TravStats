// Human-readable short label for a cruise-port marker.
//
// Port markers historically showed the raw UN/LOCODE (e.g. "ITCVV",
// "PTFNC", "DEKEL") — meaningless to users. Unlike airport IATA codes,
// nobody recognises LOCODEs, so on both the globe and the flat map we
// render the real port name instead. All-caps source names (LOCODE-style
// data dumps) are title-cased; anything longer than `maxLen` is truncated
// with an ellipsis so a busy Mediterranean cluster doesn't turn into
// label soup. Mixed-case names ("Civitavecchia", "La Coruña", "McMurdo")
// are left exactly as the source provides them.

const MAX_PORT_LABEL_LEN = 14;

export function toPortLabel(name: string, maxLen: number = MAX_PORT_LABEL_LEN): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "";
  const cased = isAllUpper(trimmed) ? titleCase(trimmed) : trimmed;
  if (cased.length <= maxLen) return cased;
  // Reserve one slot for the ellipsis; trim a trailing space so the
  // result never reads "Foo …".
  return cased.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
}

// True only when the string carries at least one upper-case letter and no
// lower-case letter — i.e. a shouty data-dump name worth normalising.
function isAllUpper(s: string): boolean {
  return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}

// Capitalise the first letter of every letter-run, lower-casing the rest:
// "PORTO DI GENOVA" → "Porto Di Genova".
function titleCase(s: string): string {
  return s.replace(
    /\p{L}+/gu,
    (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()
  );
}
