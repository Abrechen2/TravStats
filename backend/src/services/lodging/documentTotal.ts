/**
 * Let the document decide the total, not the model.
 *
 * Measured on the owner's Armani confirmation: two identical runs of the same
 * mail returned 11,662 AED and 9,520 AED — the tax-inclusive total and the bare
 * room rate. That is not a prompt that needs sharpening; it is a question the
 * model should not be the authority on. The document states it plainly:
 *
 *   Amount:                                    AED 9,520.00
 *   Tax amount excluding Tourism Dirham Fee:   AED 2,142.00
 *   Total amount including all taxes and …:    AED 11,662.00
 *
 * A label followed by a figure is provable. So the model keeps proposing, and
 * a labelled total in the source overrules it.
 */

/**
 * Money as printed, in either grouping convention.
 *
 * The rule that settles "1,234.50" against "1.234,50": when both separators
 * appear, the RIGHTMOST one is the decimal point — every locale that uses both
 * puts the grouping separator further left. With only one separator the digits
 * after it decide: exactly three means grouping ("1,500" is fifteen hundred),
 * anything else means decimal ("1,50" is one-fifty).
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  const digitsAndSeparators = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digitsAndSeparators)) return null;

  const lastComma = digitsAndSeparators.lastIndexOf(",");
  const lastDot = digitsAndSeparators.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const groupingChar = decimalAt === lastComma ? "." : ",";
    normalized =
      digitsAndSeparators.slice(0, decimalAt).split(groupingChar).join("") +
      "." +
      digitsAndSeparators.slice(decimalAt + 1).replace(/[.,]/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const at = Math.max(lastComma, lastDot);
    const tail = digitsAndSeparators.slice(at + 1);
    normalized =
      tail.length === 3
        ? digitsAndSeparators.replace(/[.,]/g, "")
        : `${digitsAndSeparators.slice(0, at).replace(/[.,]/g, "")}.${tail}`;
  } else {
    normalized = digitsAndSeparators;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Labels that mean "this is what it costs in the end".
 *
 * Deliberately multi-word: a bare "total" appears in this very document as
 * "the total number of nights selected", and matching that hands back a night
 * count as money. Every entry here names an amount, not a quantity.
 */
const TOTAL_LABELS = [
  /total\s+amount/i,
  /total\s+price/i,
  /grand\s+total/i,
  /amount\s+due/i,
  /gesamtpreis/i,
  /gesamtbetrag/i,
  /gesamtsumme/i,
  /endpreis/i,
  /rechnungsbetrag/i,
  /zu\s+zahlender?\s+betrag/i,
];

/** How far past the label a figure may sit and still belong to it. */
const LOOKAHEAD_CHARS = 120;

/** A printed amount: optional currency, digits with grouping, optional decimals. */
const AMOUNT_RE = /(?:[A-Z]{3}|[€$£])?\s*(\d[\d.,]*\d|\d)/;

/**
 * The tax-inclusive total the document names, or null when it names none.
 *
 * When several labels match, the LAST one wins: confirmations print the running
 * figures first and the final one last, and a summary block at the foot of a
 * mail is the more authoritative statement.
 */
export function findLabelledTotal(text: string): number | null {
  let found: number | null = null;

  for (const label of TOTAL_LABELS) {
    const pattern = new RegExp(label.source, `${label.flags}g`);
    for (const match of text.matchAll(pattern)) {
      const from = match.index + match[0].length;
      const window = text.slice(from, from + LOOKAHEAD_CHARS);
      const amount = AMOUNT_RE.exec(window);
      if (!amount) continue;
      const value = parseAmount(amount[1]);
      if (value !== null && value > 0) found = value;
    }
  }

  return found;
}

export type TotalSource = "document" | "model" | "none";

export interface ReconciledTotal {
  value: number | null;
  source: TotalSource;
}

/** Below this the two figures are the same money written differently. */
const AGREEMENT_EPSILON = 0.01;

/**
 * Reconcile what the model proposed against what the document states.
 *
 * `source` is reported rather than swallowed: a caller that wants to flag a
 * corrected price, or count how often the model and the document disagree,
 * needs to know which one it got.
 */
export function reconcileTotalPrice(modelValue: number | null, text: string): ReconciledTotal {
  const documentValue = findLabelledTotal(text);

  if (documentValue === null) {
    return modelValue === null ? { value: null, source: "none" } : { value: modelValue, source: "model" };
  }
  if (modelValue === null) return { value: documentValue, source: "document" };
  if (Math.abs(modelValue - documentValue) < AGREEMENT_EPSILON) {
    return { value: modelValue, source: "model" };
  }
  return { value: documentValue, source: "document" };
}
