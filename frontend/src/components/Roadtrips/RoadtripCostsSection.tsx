import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { Icon } from "../ui/Icon";
import ExpenseDialog from "./ExpenseDialog";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatCurrency } from "../../lib/units";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  AmountsByCurrency,
  ExpenseBaseTotal,
  RoadtripCosts,
  TripExpense,
} from "../../types/expense";
import type { RoadtripStation } from "../../types/roadtrip";
import { fxSourceKey } from "./expenseFx";

/** "1.290 kr + 17,50 €" — per currency, never converted, never added together. */
export function formatAmounts(amounts: AmountsByCurrency, language: string): string {
  return Object.entries(amounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, value]) => formatCurrency(value, code, { language }))
    .join(" + ");
}

/**
 * Whether the base-currency line says anything the per-currency line does
 * not: not when everything was paid in the base currency already, and not as
 * a number when NOTHING could be converted — "≈ 0 €" for a trip that cost
 * 1.290 kr would be a figure nobody recorded.
 */
export function baseTotalState(
  total: AmountsByCurrency,
  base: ExpenseBaseTotal | undefined
): "hidden" | "noneConverted" | "shown" {
  const codes = Object.keys(total);
  if (!base || codes.length === 0) return "hidden";
  const unconverted = Object.keys(base.unconverted);
  if (unconverted.length === 0 && codes.length === 1 && codes[0] === base.currency) {
    return "hidden";
  }
  const allUnconverted = codes.every((code) => base.unconverted[code] === total[code]);
  return allUnconverted ? "noneConverted" : "shown";
}

/**
 * The roadtrip's costs (forgejo#140): ferry tickets, tolls, pitch fees, fuel —
 * the total per currency, then each expense with where it was paid. The sums
 * are the server's (`costs`), so this page and the statistics cannot disagree
 * about what the roadtrip cost. A row opens it for editing; deleting is in
 * there too, one deliberate step away from an accidental tap.
 *
 * The base-currency total (forgejo#150) is `totalBase.amount` as the server
 * computed it from each expense's recorded rate — never a sum made here — and
 * whatever had no rate is named beside it rather than quietly left out.
 */
export default function RoadtripCostsSection({
  roadtripId,
  stations,
  expenses,
  costs,
  onChanged,
}: {
  roadtripId: string;
  stations: readonly RoadtripStation[];
  expenses: readonly TripExpense[];
  costs: RoadtripCosts;
  onChanged: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const [editing, setEditing] = useState<TripExpense | "new" | null>(null);

  const titleOf = (id: string | null): string =>
    stations.find((s) => s.id === id)?.title ?? t("roadtrips:costs.removedStation");
  const placeOf = (e: TripExpense): string => {
    if (e.stopId !== null) return titleOf(e.stopId);
    if (e.legFromStopId !== null || e.legToStopId !== null) {
      return t("roadtrips:costs.leg", {
        from: titleOf(e.legFromStopId),
        to: titleOf(e.legToStopId),
      });
    }
    return t("roadtrips:costs.wholeTrip");
  };
  const baseState = baseTotalState(costs.total, costs.totalBase);
  const money = (value: number, code: string): string =>
    formatCurrency(value, code, { language: i18n.language });
  // A new expense starts in the currency last used here, else the account's own.
  const defaultCurrency = expenses[expenses.length - 1]?.currency ?? baseCurrency;

  return (
    <section className="flex flex-col" style={{ gap: 14, marginTop: "var(--ts-space-xxl)" }}>
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <h2 className="t-card-title">{t("roadtrips:costs.title")}</h2>
        <Button
          variant="secondary"
          icon={<Icon name="plus" size={16} />}
          onClick={() => setEditing("new")}
        >
          {t("roadtrips:costs.add")}
        </Button>
      </div>

      {expenses.length === 0 ? (
        <p className="t-caption">{t("roadtrips:costs.empty")}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline" style={{ gap: 8 }}>
            <span className="t-caption">{t("roadtrips:costs.total")}</span>
            <strong data-testid="roadtrip-costs-total" style={{ fontSize: 18 }}>
              {formatAmounts(costs.total, i18n.language)}
            </strong>
            {Object.keys(costs.total).length > 1 && (
              <span className="t-caption">{t("roadtrips:costs.perCurrencyHint")}</span>
            )}
          </p>
          {baseState !== "hidden" && (
            <BaseTotalLine
              base={costs.totalBase}
              noneConverted={baseState === "noneConverted"}
              language={i18n.language}
            />
          )}
          <ul className="flex flex-col" style={{ gap: 6, listStyle: "none", padding: 0 }}>
            {expenses.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className="flex w-full items-center justify-between text-left"
                  style={{
                    gap: 12,
                    minHeight: "var(--ts-size-touch-min)",
                    padding: "8px 12px",
                    borderRadius: "var(--ts-radius-button)",
                    border: "1px solid var(--ts-border)",
                    background: "var(--ts-surface)",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                      {t(`roadtrips:costs.kind.${e.kind}`)}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className="t-caption">
                      {[
                        placeOf(e),
                        e.date ? display.date(`${e.date}T00:00:00Z`, { timeZone: "UTC" }) : null,
                        e.payer ? t("roadtrips:costs.paidBy", { name: e.payer.name }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end" style={{ gap: 2 }}>
                    <span
                      className="flex items-center"
                      style={{ gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}
                    >
                      {e.documentCount > 0 && (
                        <span
                          className="flex items-center"
                          data-testid="expense-receipt"
                          title={t("roadtrips:costs.receipt.count", { count: e.documentCount })}
                          style={{ color: "var(--ts-muted)" }}
                        >
                          <Icon name="file-text" size={14} />
                          <span className="sr-only">
                            {t("roadtrips:costs.receipt.count", { count: e.documentCount })}
                          </span>
                        </span>
                      )}
                      {money(e.amount, e.currency)}
                    </span>
                    {e.fx && e.fx.baseCurrency !== e.currency && (
                      <span className="t-caption" style={{ whiteSpace: "nowrap" }}>
                        {t("roadtrips:costs.fx.rowConverted", {
                          amount: money(e.fx.amountBase, e.fx.baseCurrency),
                          source: t(fxSourceKey(e.fx.source)),
                        })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing !== null && (
        <ExpenseDialog
          roadtripId={roadtripId}
          stations={stations}
          expense={editing === "new" ? null : editing}
          defaultCurrency={defaultCurrency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/** "≈ 1.234,56 € in Hauswährung", and what it does not contain. */
function BaseTotalLine({
  base,
  noneConverted,
  language,
}: {
  base: ExpenseBaseTotal;
  noneConverted: boolean;
  language: string;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const missing = Object.keys(base.unconverted).length > 0;
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      {noneConverted ? (
        <p className="t-caption" data-testid="roadtrip-costs-base-none">
          {t("roadtrips:costs.base.noneConverted")}
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline" style={{ gap: 8 }}>
          <span data-testid="roadtrip-costs-base" style={{ fontWeight: 700 }}>
            {t("roadtrips:costs.base.total", {
              amount: formatCurrency(base.amount, base.currency, { language }),
            })}
          </span>
          <span className="t-caption">{t("roadtrips:costs.base.hint")}</span>
        </p>
      )}
      {missing && !noneConverted && (
        <p className="t-caption" data-testid="roadtrip-costs-base-unconverted">
          {t("roadtrips:costs.base.unconverted", {
            amounts: formatAmounts(base.unconverted, language),
          })}
        </p>
      )}
    </div>
  );
}
