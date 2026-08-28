/**
 * Excel gives you strings. The domain schemas want numbers, booleans, dates
 * and nulls. This is that translation, in one place, because a handler doing
 * it inline would eventually do it differently.
 *
 * Everything here treats an EMPTY cell as `undefined` — "not mentioned" —
 * rather than as null. The distinction matters on update: an omitted key
 * leaves the stored value alone, while an explicit null would erase it. A user
 * who clears a cell in Excel is far more likely to have been tidying the view
 * than to be asking us to delete the value, and the destructive reading of an
 * ambiguous gesture is the wrong default.
 */

/** Trimmed text, or undefined when the cell is blank. */
export function text(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

/**
 * A number, or undefined when blank.
 *
 * Accepts what a German Excel actually writes: "1.899,50" as well as
 * "1899.50". A cell that is not a number at all returns NaN rather than
 * undefined, so the caller can refuse the row instead of silently dropping
 * a price the user typed.
 */
export function num(raw: string | undefined): number | undefined {
  const v = raw?.trim();
  if (!v) return undefined;

  // Decide which separator is the decimal one by whichever comes LAST.
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  let normalised = v.replace(/\s/g, "");
  if (lastComma > lastDot) {
    normalised = normalised.replace(/\./g, "").replace(",", ".");
  } else {
    normalised = normalised.replace(/,/g, "");
  }
  return Number(normalised);
}

/** An integer, or undefined. NaN when the cell holds something else. */
export function int(raw: string | undefined): number | undefined {
  const n = num(raw);
  if (n === undefined) return undefined;
  return Number.isNaN(n) ? NaN : Math.trunc(n);
}

/**
 * A boolean from the several things a spreadsheet may hold.
 *
 * Excel writes TRUE/FALSE, a German locale WAHR/FALSCH, exceljs round-trips
 * `true`/`false`, and people type "ja"/"x"/"1". Anything unrecognised returns
 * undefined rather than guessing false — a misread checkbox silently flipping
 * "visited" off is worse than a refused row.
 */
export function bool(raw: string | undefined): boolean | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (["true", "wahr", "ja", "yes", "y", "j", "x", "1"].includes(v)) return true;
  if (["false", "falsch", "nein", "no", "n", "0"].includes(v)) return false;
  return undefined;
}

/**
 * A date as a plain `YYYY-MM-DD` string, or undefined.
 *
 * Cells written by our own exporter come back as ISO timestamps; a hand-typed
 * cell may be "2024-04-03" or "03.04.2024". The German form is read as
 * day-first deliberately: this is the locale the UI is written for, and
 * guessing month-first would turn the 3rd of April into the 4th of March
 * without complaining. Anything unparseable returns null so the caller can
 * refuse the row.
 */
export function isoDate(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;

  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (german) {
    const [, d, m, y] = german;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Full ISO timestamp, for the fields that carry a time. */
export function isoDateTime(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** A comma-separated cell as a list. Empty cell → undefined, not []. */
export function list(raw: string | undefined): string[] | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The id out of a `Name [id]` reference cell.
 *
 * Mirrors `frontend/src/lib/xlsx/sheetSpec.ts#parseRefCell` — the two halves
 * of the round trip must agree on this or references silently stop resolving.
 * A cell with no brackets yields undefined: the name alone is never used to
 * guess a target, because guessing is how one trip becomes two.
 */
export function ref(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const match = /\[([^\]]+)\]\s*$/.exec(v);
  const id = match?.[1]?.trim();
  return id || undefined;
}
