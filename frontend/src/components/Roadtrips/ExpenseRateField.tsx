import type { JSX } from "react";

import { Field, Input } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatCurrency } from "../../lib/units";
import type { ExpenseFx } from "../../types/expense";
import { parseAmount, type ExpenseDraft } from "./expenseDraft";
import { formatRate, fxSourceKey, parseRate, rateText } from "./expenseFx";

export const RATE_ID = "expense-fx-rate";

type RatePatch = Pick<ExpenseDraft, "fxMode" | "fxRate">;

const LINK_CLASS = "self-start underline pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * The exchange rate of one expense (forgejo#150): the recorded one, read-only
 * and labelled by where it came from; a rate typed by hand; or none.
 *
 * Nothing here converts on its own. The recorded `amountBase` is the server's;
 * the "≈" under a typed rate is a preview of the reader's own two numbers, so
 * an inverted rate (11,5 instead of 0,087) is visible before it is saved.
 */
export default function ExpenseRateField({
  stored,
  draft,
  baseCurrency,
  onChange,
  rateError,
}: {
  /**
   * The rate on the stored expense with the currency it converts FROM (the
   * stored one, not the draft's); null for a new expense or one without.
   */
  stored: (ExpenseFx & { currency: string }) | null;
  draft: ExpenseDraft;
  baseCurrency: string;
  onChange: (patch: Partial<RatePatch>) => void;
  rateError?: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const language = i18n.language;
  const money = (value: number, code: string): string => formatCurrency(value, code, { language });

  // A cost in the base currency needs no rate, and none was ever recorded.
  if (draft.currency === baseCurrency && stored === null) return null;

  const action = (label: string, patch: Partial<RatePatch>): JSX.Element => (
    <button
      type="button"
      className={LINK_CLASS}
      style={{ fontSize: 13, color: "var(--ts-accent)" }}
      onClick={() => onChange(patch)}
    >
      {label}
    </button>
  );

  const typed = parseRate(draft.fxRate);
  const amount = parseAmount(draft.amount);

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <span className="t-caption" style={{ color: "var(--ts-muted)" }}>
        {t("roadtrips:costs.fx.title")}
      </span>

      {draft.fxMode === "manual" ? (
        <>
          <Field
            label={t("roadtrips:costs.fx.manualLabel", {
              currency: draft.currency,
              base: baseCurrency,
            })}
            htmlFor={RATE_ID}
            error={rateError}
          >
            <Input
              id={RATE_ID}
              inputMode="decimal"
              aria-required="true"
              value={draft.fxRate}
              invalid={rateError !== undefined}
              onChange={(e) => onChange({ fxRate: e.target.value })}
            />
          </Field>
          {typed !== null && amount !== null && (
            <span className="t-caption" data-testid="expense-fx-preview">
              {t("roadtrips:costs.fx.preview", { amount: money(amount * typed, baseCurrency) })}
            </span>
          )}
          {action(t("roadtrips:costs.fx.cancelManual"), {
            fxMode: "keep",
            fxRate: rateText(stored),
          })}
        </>
      ) : draft.fxMode === "remove" ? (
        <>
          <p className="t-caption" role="status">
            {t("roadtrips:costs.fx.removing")}
          </p>
          {action(t("roadtrips:costs.fx.undoRemove"), { fxMode: "keep" })}
        </>
      ) : (
        <>
          <p className="t-caption" data-testid="expense-fx-recorded">
            {stored
              ? t("roadtrips:costs.fx.recorded", {
                  rate: `1 ${stored.currency} = ${formatRate(stored.rate, language)} ${stored.baseCurrency}`,
                  source: t(fxSourceKey(stored.source)),
                  day: display.date(`${stored.rateDate}T00:00:00Z`, { timeZone: "UTC" }),
                  amount: money(stored.amountBase, stored.baseCurrency),
                })
              : t(draft.date === "" ? "roadtrips:costs.fx.noneUndated" : "roadtrips:costs.fx.none")}
          </p>
          {stored && <span className="t-caption">{t("roadtrips:costs.fx.relookupHint")}</span>}
          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-md)" }}>
            {draft.currency !== baseCurrency &&
              action(t("roadtrips:costs.fx.enterManual"), { fxMode: "manual" })}
            {stored && action(t("roadtrips:costs.fx.remove"), { fxMode: "remove" })}
          </div>
        </>
      )}
    </div>
  );
}
