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

import { isCurrencyCode } from "../../shared/currencies";

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

/**
 * A printed amount, and only that.
 *
 * The first version took any digits after the label, which read
 * "Gesamtpreis gilt für die gebuchte Anzahl an Gästen (1 Erwachsener)" as a
 * total of 1 — and, because the document outranks the model, wrote it over a
 * correct $135.87. A number is money only if it carries a currency marker or
 * has a two-digit decimal tail; a bare integer in prose is a count.
 */
const MONEY_RE =
  /(?<pre>[A-Z]{3}|[€$£¥])?\s*(?<num>\d[\d.,]*\d|\d)\s*(?<post>[A-Z]{3}|[€$£¥])?/g;

function looksLikeMoney(num: string, pre?: string, post?: string): boolean {
  if (pre || post) return true;
  // "135,87" / "135.87" — a decimal tail of exactly two digits.
  return /[.,]\d{2}$/.test(num);
}

/**
 * The unit a marker next to a figure names, when it names exactly one. A
 * three-letter code is checked against ISO-4217; "€" and "£" are unambiguous.
 * "$" and "¥" are not — US, Singapore, Australian, Chinese, Japanese — so they
 * stay unknown rather than being guessed.
 */
function currencyOfMarker(marker: string | undefined): string | null {
  if (!marker) return null;
  if (marker === "€") return "EUR";
  if (marker === "£") return "GBP";
  return isCurrencyCode(marker) ? marker : null;
}

export interface LabelledMoney {
  value: number;
  /** Null when the figure carried no marker, or an ambiguous one. */
  currency: string | null;
}

/**
 * The tax-inclusive total the document names — with its unit, where the
 * document prints one — or null when it names none.
 *
 * When several labels match, the LAST one wins: confirmations print the running
 * figures first and the final one last, and a summary block at the foot of a
 * mail is the more authoritative statement.
 */
export function findLabelledMoney(text: string): LabelledMoney | null {
  // The amount a label refers to is the one printed right after it. Ranking by
  // DISTANCE rather than by document order is what separates
  //   "Gesamtpreis	$135,87"                        -> 0 characters away
  // from
  //   "Der Gesamtpreis gilt für ... Frühstück $15"   -> sixty characters away
  // in a document that says "Gesamtpreis" twice.
  let best: { distance: number; money: LabelledMoney } | null = null;

  for (const label of TOTAL_LABELS) {
    const pattern = new RegExp(label.source, `${label.flags}g`);
    for (const match of text.matchAll(pattern)) {
      const from = match.index + match[0].length;
      const window = text.slice(from, from + LOOKAHEAD_CHARS);
      MONEY_RE.lastIndex = 0;
      for (const money of window.matchAll(MONEY_RE)) {
        const { pre, num, post } = money.groups ?? {};
        if (!num || !looksLikeMoney(num, pre, post)) continue;
        const value = parseAmount(num);
        if (value === null || value <= 0) continue;
        const distance = money.index ?? 0;
        // `<=` so a later label wins a tie: a summary block at the foot of a
        // mail is the more authoritative statement.
        if (best === null || distance <= best.distance) {
          best = {
            distance,
            money: { value, currency: currencyOfMarker(pre) ?? currencyOfMarker(post) },
          };
        }
        break;
      }
    }
  }

  return best?.money ?? null;
}

/** `findLabelledMoney` for callers that only want the figure. */
export function findLabelledTotal(text: string): number | null {
  return findLabelledMoney(text)?.value ?? null;
}

/**
 * The part of a multi-booking document that belongs to ONE booking: from the
 * first mention of its hotel to the first later mention of any other hotel
 * the model found. With a single booking the whole text is its section.
 *
 * Returns "" — a section in which no total can be found — when the hotel's
 * name does not appear at all in a document that holds several bookings: a
 * total that cannot be attributed must not overrule anything (AUD-050).
 */
export function documentSectionFor(
  text: string,
  hotelName: string | null,
  otherHotelNames: readonly string[],
): string {
  if (otherHotelNames.length === 0) return text;
  if (!hotelName) return "";
  const lower = text.toLowerCase();
  const start = lower.indexOf(hotelName.toLowerCase());
  if (start < 0) return "";
  const ends = otherHotelNames
    .map((other) => lower.indexOf(other.toLowerCase(), start + hotelName.length))
    .filter((at) => at >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : text.length;
  return text.slice(start, end);
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
 *
 * `modelCurrency` is the unit the RESULT will carry. A labelled total printed
 * in a different unit — the "EUR 100.00" a Dubai hotel shows under its
 * 400 AED fee — is a conversion, not the price, and is left alone rather than
 * written as 100 AED (AUD-050). A figure with no marker is compared as before.
 */
export function reconcileTotalPrice(
  modelValue: number | null,
  text: string,
  modelCurrency?: string | null,
): ReconciledTotal {
  const labelled = findLabelledMoney(text);
  const documentValue =
    labelled === null || (modelCurrency && labelled.currency && labelled.currency !== modelCurrency)
      ? null
      : labelled.value;

  if (documentValue === null) {
    return modelValue === null ? { value: null, source: "none" } : { value: modelValue, source: "model" };
  }
  if (modelValue === null) return { value: documentValue, source: "document" };
  if (Math.abs(modelValue - documentValue) < AGREEMENT_EPSILON) {
    return { value: modelValue, source: "model" };
  }
  return { value: documentValue, source: "document" };
}
