import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatCurrency } from "../../lib/units";
import {
  countedStays,
  countUnconvertedStays,
  hasAnyPrice,
  singleCurrencySpend,
  singleOriginalCurrencySpend,
} from "../../lib/lodgingFormat";
import type { Lodging } from "../../types/lodging";
import { PlannedSpendNote } from "./PlannedSpendNote";

/**
 * True when this lodging has spend snapshotted under a base currency OTHER
 * than the user's current one — i.e. `totalSpendBase` (which only counts the
 * current-base slice) is not the whole picture. Used to render a small,
 * honest "*" hint rather than silently folding those older amounts in
 * (finding 2).
 */
export function hasOtherBaseCurrencySpend(
  byCurrency: Record<string, number>,
  currentBaseCurrency: string
): boolean {
  return Object.keys(byCurrency).some((currency) => currency !== currentBaseCurrency);
}

/**
 * Spend column body for one list row (mockup screen ①): the original
 * currency amount with the converted total underneath when every priced
 * stay shares one non-base currency (e.g. "840 CHF" / "≈ 883 €"), the plain
 * converted total when spend is already base-currency or mixed, and "—"
 * (never "0 €") when nothing on this lodging has a recorded price at all.
 */
export function LodgingSpendCell({
  lodging,
  baseCurrency,
}: {
  lodging: Lodging;
  baseCurrency: string;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  // Guard and figure read the SAME set: `totalSpendBase` is summed over the
  // stays that count (check-out past), so the branch must be chosen from
  // those too. Chosen from all stays, a house whose only stay was planned
  // and priced fell through to the converted total and printed "0 €"
  // (forgejo#82). The planned price is not lost — it gets its own line.
  const counted = countedStays(lodging.stays);
  const planned = <PlannedSpendNote stays={lodging.stays} />;
  if (!hasAnyPrice(counted)) {
    return <>—{planned}</>;
  }

  const original = singleOriginalCurrencySpend(counted, baseCurrency);
  // Priced, but nothing converted: `totalSpendBase` is 0 because the sum has
  // no addends, NOT because the stay cost nothing. Rendering that zero told
  // the reader a hotel was free — and where an original amount was shown it
  // read "$780 ≈ 0 €", which is worse, because it looks like arithmetic.
  //
  // Asked as "is every priced stay unconverted", never as `totalSpendBase === 0`:
  // a genuinely free night (an award stay entered as 0) converts fine and its
  // total is honestly zero.
  const pricedCount = counted.filter((s) => s.totalPrice !== null).length;
  const unconverted = countUnconvertedStays(counted);
  const nothingConverted = unconverted === pricedCount;
  // Some converted, some not: the figure below is real but incomplete, and
  // saying so is the same rule the detail page and the stat strip follow.
  const omitted =
    !nothingConverted && unconverted > 0 ? (
      <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
        {t("lodging:fx.omittedFromTotal", { count: unconverted })}
      </div>
    ) : null;
  if (nothingConverted) {
    // `singleCurrencySpend`, not `original`: with no conversion shown next to
    // it there is nothing for a base-currency amount to be redundant WITH, and
    // hiding it left the row saying "kein Kurs" with no number at all.
    const amount = singleCurrencySpend(counted);
    return (
      <>
        {amount && <div>{formatCurrency(amount.amount, amount.currency)}</div>}
        <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
          {t("lodging:fx.markerNone")}
        </div>
        {planned}
      </>
    );
  }
  if (!original) {
    return (
      <>
        <div>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</div>
        {omitted}
        {planned}
      </>
    );
  }

  return (
    <>
      <div>{formatCurrency(original.amount, original.currency)}</div>
      <div className="text-[10px]" style={{ color: "var(--fx, #6ab7d8)" }}>
        ≈ {formatCurrency(lodging.totalSpendBase, baseCurrency)}
      </div>
      {omitted}
      {planned}
    </>
  );
}
