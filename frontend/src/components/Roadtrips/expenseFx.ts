import type { ExpenseFx, ExpenseFxOutcome, ExpenseFxSource } from "../../types/expense";

/**
 * How an expense's exchange rate is named on screen (forgejo#150).
 *
 * A rate the user typed or one the phone had cached is never dressed as an
 * official one: each source has its own word, and the readout always carries
 * it. `ecb` and `cdn` are separate words for the same reason the stay readout
 * keeps them apart (`lib/lodgingFormat.ts`): the ECB publishes thirty
 * currencies, so a market rate labelled "EZB" would state something untrue.
 */
export function fxSourceKey(source: ExpenseFxSource): string {
  return `roadtrips:costs.fx.source.${source}`;
}

/** A rate with enough digits to be checked against a bank statement: "0,0868". */
export function formatRate(rate: number, language: string): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(rate);
}

/** A typed rate as a number, or null when it is empty, not a number, or not above zero. */
export function parseRate(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The rate as the input first shows it — the stored one, so "change" starts from it. */
export function rateText(fx: ExpenseFx | null): string {
  return fx ? String(fx.rate) : "";
}

/**
 * The two outcomes of a write the reader must hear about, as a sentence key;
 * null for the ones that need no word. `lookupFailed` is a saved expense with
 * no rate — it counts in its own currency only. `keptStoredRate` re-priced the
 * new amount at the rate already stored, because no fresh one could be had.
 */
export function fxOutcomeNotice(
  outcome: ExpenseFxOutcome
): { key: string; type: "warning" | "info" } | null {
  if (outcome === "lookupFailed") {
    return { key: "roadtrips:costs.fx.outcome.lookupFailed", type: "warning" };
  }
  if (outcome === "keptStoredRate") {
    return { key: "roadtrips:costs.fx.outcome.keptStoredRate", type: "info" };
  }
  return null;
}
