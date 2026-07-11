import { formatCurrency } from "./units";

const FALLBACK = "—";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The subset of `LodgingStay` needed to render its price + FX readout.
 * Kept as its own shape (rather than importing the full `LodgingStay`) so
 * this module has no dependency on the wider lodging type surface.
 */
export interface StayPriceSnapshot {
  totalPrice: number | null;
  currency: string;
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: string | null;
  fxBaseCurrency: string | null;
}

export interface StayPriceDisplay {
  /** The stay's price in its own currency (e.g. "840 CHF"), or "—" when there is no price. */
  original: string;
  /**
   * The full conversion readout (e.g. "840 CHF → 883 € · EZB 0,9895 · 12.05.24").
   *
   * `null` whenever the FX snapshot is incomplete — the backend clears
   * `totalPriceBase`/`fxRate`/`fxRateDate`/`fxBaseCurrency` together whenever
   * the ECB rate lookup failed at save time (the stay itself still saves).
   * Callers MUST treat `null` as "render `original` alone" — never build a
   * partial readout from whichever FX fields happen to be non-null.
   */
  fxReadout: string | null;
}

function localeForLanguage(language: string | undefined): string {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "de-DE";
}

function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(rate);
}

/** Short "dd.MM.yy" style date (e.g. "12.05.24") for the compact FX readout line. */
function formatShortDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Build the price display for one stay: the original amount always, and the
 * FX conversion readout only when the full snapshot is present.
 *
 * `fxSourceLabel` is the translated rate-source label ("EZB" / "ECB") — kept
 * as a parameter rather than an i18n dependency so this module stays a pure,
 * UI-framework-free formatter.
 */
export function formatStayPriceDisplay(
  stay: StayPriceSnapshot,
  language: string | undefined,
  fxSourceLabel: string
): StayPriceDisplay {
  const locale = localeForLanguage(language);
  const original =
    stay.totalPrice !== null ? formatCurrency(stay.totalPrice, stay.currency) : FALLBACK;

  // Destructure into locals so TypeScript can narrow each field from the
  // null checks below — narrowing a combined boolean doesn't propagate back
  // to `stay.totalPriceBase` etc.
  const { totalPriceBase, fxRate, fxRateDate, fxBaseCurrency } = stay;
  if (totalPriceBase === null || fxRate === null || fxRateDate === null || fxBaseCurrency === null) {
    return { original, fxReadout: null };
  }

  const base = formatCurrency(totalPriceBase, fxBaseCurrency);
  const rate = formatRate(fxRate, locale);
  const date = formatShortDate(fxRateDate, locale);

  return {
    original,
    fxReadout: `${original} → ${base} · ${fxSourceLabel} ${rate} · ${date}`,
  };
}

/** Whole nights between check-in and check-out. Never negative (a malformed/inverted range clamps to 0). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return 0;
  return Math.max(0, Math.round((outMs - inMs) / MS_PER_DAY));
}
