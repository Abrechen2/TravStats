import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { Icon } from "../ui/Icon";
import ExpenseDialog from "./ExpenseDialog";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatCurrency } from "../../lib/units";
import { useSettingsStore } from "../../store/settingsStore";
import type { AmountsByCurrency, RoadtripCosts, TripExpense } from "../../types/expense";
import type { RoadtripStation } from "../../types/roadtrip";

/** "1.290 kr + 17,50 €" — per currency, never converted, never added together. */
export function formatAmounts(amounts: AmountsByCurrency, language: string): string {
  return Object.entries(amounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, value]) => formatCurrency(value, code, { language }))
    .join(" + ");
}

/**
 * The roadtrip's costs (forgejo#140): ferry tickets, tolls, pitch fees, fuel —
 * the total per currency, then each expense with where it was paid. The sums
 * are the server's (`costs`), so this page and the statistics cannot disagree
 * about what the roadtrip cost. A row opens it for editing; deleting is in
 * there too, one deliberate step away from an accidental tap.
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
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {formatCurrency(e.amount, e.currency, { language: i18n.language })}
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
