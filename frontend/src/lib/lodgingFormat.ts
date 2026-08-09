import { formatCurrency } from "./units";
import type { LodgingType } from "../types/lodging";

const FALLBACK = "—";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LODGING_TYPE_ICONS: Record<LodgingType, string> = {
  hotel: "🏨",
  campsite: "⛺",
  guesthouse: "🏡",
  apartment: "🏢",
  hostel: "🛏️",
};

/**
 * Emoji glyph for a lodging type — one shared mapping so the list, chain-detail,
 * detail, and dashboard-sidebar rows all render the same icon per type instead
 * of four independent `type === "campsite" ? … : …` ternaries (which silently
 * fell back to the hotel icon for any type added after campsite).
 */
export function lodgingTypeIcon(type: LodgingType): string {
  return LODGING_TYPE_ICONS[type];
}

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

  // A stay already priced in the base currency has a COMPLETE snapshot —
  // `convertToBase` short-circuits an identical pair to {baseAmount: amount,
  // rate: 1}, which is honest data and stays stored, because aggregations read
  // `totalPriceBase`. It is only the READOUT that must not appear: "120 € →
  // 120 € · EZB 1,0000" shows the reader an exchange rate for a conversion
  // that never happened (reported 2026-07-12). The guard is on the currency
  // PAIR, never on `fxRate === 1` — CHF→EUR can legitimately sit at parity.
  if (stay.currency === fxBaseCurrency) {
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

// The overall stay rating used to be derived HERE, and only here — which is
// why it was correct only for stays typed into the editor and null for every
// imported one. It now lives in `shared/ratingDerivation.ts` next to its
// backend twin, called by the editor and by all three server write paths.
// Deliberately not re-exported from this module: a second entry point is how
// the rule drifted out of the write paths in the first place.

/**
 * Price per night, derived from the total price and the stay's length.
 *
 * Also Alex, same message: it was a second hand-typed number that could
 * silently contradict the total. Returns null when there is no total, or when
 * the date range yields no whole night (a same-day or inverted range) — a
 * division by zero must surface as "unknown", never as Infinity.
 */
export function derivePricePerNight(
  totalPrice: number | null,
  checkIn: string,
  checkOut: string
): number | null {
  if (totalPrice === null) return null;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return null;
  return Math.round((totalPrice / nights) * 100) / 100;
}

/** Whole nights between check-in and check-out. Never negative (a malformed/inverted range clamps to 0). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return 0;
  return Math.max(0, Math.round((outMs - inMs) / MS_PER_DAY));
}

/**
 * "★ 4.3" for a rating value, "—" when unrated. Half-steps render as-is
 * (e.g. 4.5). Single shared plain-text formatter for the compact rating
 * mentions the mockup ALSO renders as plain text (meta lines, per-category
 * inline mentions like "Frühstück ★4") — for the full filled/half/muted
 * star-glyph rendering (mockup's list-table and rating-card cells), use the
 * `StarRating` component instead.
 */
export function formatRatingText(value: number | null): string {
  return value !== null ? `★ ${value}` : FALLBACK;
}

/** The subset of `LodgingStay` needed to derive a lodging's original-currency spend. */
export interface StaySpendSnapshot {
  totalPrice: number | null;
  currency: string;
}

/** True when at least one stay has a recorded price — used to tell a genuine
 * zero-spend total apart from "nothing priced yet" (a cleared/never-entered
 * price must render "—", never "0 €" — see `hasAnyPrice` callers). */
export function hasAnyPrice(stays: readonly StaySpendSnapshot[]): boolean {
  return stays.some((s) => s.totalPrice !== null);
}

/**
 * When every priced stay on a lodging shares the SAME currency and that
 * currency differs from the user's base currency, returns that shared
 * original-currency total — a plain sum of the already-stored `totalPrice`
 * values, no FX math performed here (the converted figure the caller pairs
 * this with is `Lodging.totalSpendBase`, already computed server-side).
 *
 * Returns `null` when every priced stay is already in the base currency,
 * when priced stays mix multiple currencies (no single honest "original"
 * amount to show), or when nothing is priced — callers fall back to
 * showing only the converted total in all three cases.
 */
export function singleOriginalCurrencySpend(
  stays: readonly StaySpendSnapshot[],
  baseCurrency: string
): { amount: number; currency: string } | null {
  let amount = 0;
  let currency: string | null = null;
  for (const stay of stays) {
    if (stay.totalPrice === null) continue;
    if (currency === null) currency = stay.currency;
    else if (currency !== stay.currency) return null; // mixed currencies — no single "original"
    amount += stay.totalPrice;
  }
  if (currency === null || currency === baseCurrency) return null;
  return { amount, currency };
}

export interface OtherCurrencySpend {
  /** Sum of every non-base-currency amount, grouped by currency — original amounts, no FX math. */
  currencies: readonly { currency: string; amount: number }[];
  /** The combined converted total for all of those non-base amounts. */
  convertedTotal: number;
}

/**
 * Sum of `LodgingStats.spendByCurrency` amounts NOT in the user's base
 * currency, and the matching converted total — both derived from numbers
 * `GET /stats/lodging` already computed, with no FX math performed here:
 *
 * - the base-currency-native amount (`spendByCurrency[baseCurrency]`) always
 *   equals its own `totalPriceBase` slice one-for-one (an identity
 *   conversion, rate 1 — see `convertToBase`'s `from === base` short
 *   circuit), so subtracting it from `spendBaseTotal` (the combined
 *   converted total across every currency) isolates exactly the portion
 *   that came from foreign-currency stays.
 *
 * Returns `null` when there is no foreign-currency spend to show, or when
 * the derived converted total isn't positive (a defensive guard against a
 * stats snapshot where every foreign stay's FX lookup happened to fail).
 */
export function otherCurrencySpend(
  spendByCurrency: Record<string, number>,
  spendBaseTotal: number,
  baseCurrency: string,
): OtherCurrencySpend | null {
  const otherEntries = Object.entries(spendByCurrency).filter(
    ([currency, amount]) => currency !== baseCurrency && amount > 0,
  );
  if (otherEntries.length === 0) return null;
  const convertedTotal = spendBaseTotal - (spendByCurrency[baseCurrency] ?? 0);
  if (convertedTotal <= 0) return null;
  return {
    currencies: otherEntries.map(([currency, amount]) => ({ currency, amount })),
    convertedTotal,
  };
}

/** The subset of `LodgingStay` needed to derive per-category rating averages. */
export interface StayCategoryRatings {
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
}

export interface CategoryRatingAverages {
  room: number | null;
  breakfast: number | null;
  service: number | null;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/**
 * Averages a lodging's stays' per-category ratings (Zimmer / Frühstück /
 * Service), nulls ignored per category — mirrors the backend's own
 * `deriveOverallRating` rounding (one decimal), but per category instead of
 * collapsed into one aggregate (mockup screen ②'s "★ Ø-Bewertung" card).
 */
export function averageRatingsByCategory(stays: readonly StayCategoryRatings[]): CategoryRatingAverages {
  return {
    room: average(stays.map((s) => s.ratingRoom).filter((v): v is number => v !== null)),
    breakfast: average(stays.map((s) => s.ratingBreakfast).filter((v): v is number => v !== null)),
    service: average(stays.map((s) => s.ratingService).filter((v): v is number => v !== null)),
  };
}
