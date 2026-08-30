import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { formatCurrency } from "../../../lib/units";
import type { CruiseStatsDetail } from "../../../lib/stats/cruiseStatsDetail";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";

interface Props {
  detail: CruiseStatsDetail;
  accent: string;
  locale: string;
}

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

const shipName = (cruise: { shipNameOverride?: string | null; ship?: { name?: string } | null; cruiseLine?: string | null }): string =>
  cruise.shipNameOverride || cruise.ship?.name || cruise.cruiseLine || "—";

const shortDate = (iso: string | null, locale: string): string =>
  iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short" }) : "—";

/**
 * When the cruises happened — the block the cruise tab never had.
 *
 * The rollup endpoint answers the collection questions (ports, ships, lines,
 * sea days) and has never carried a calendar. A cruise with no start date is
 * counted in the totals and drawn on no chart, and the section says so rather
 * than letting the bars look short.
 */
export function CruiseRhythmSection({ detail, accent }: Props): JSX.Element | null {
  const { t } = useTranslation(["cruise", "stats", "common"]);

  if (detail.dated.length === 0) return null;

  const maxYear = Math.max(...detail.byYear.map((y) => y.cruises), 1);
  const maxMonth = Math.max(...detail.byMonth, 1);
  const busiestMonth = detail.byMonth.indexOf(Math.max(...detail.byMonth));

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("cruise:stats.rhythm.title")}
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("cruise:stats.rhythm.season")}
          value={t(`stats:months.${MONTH_KEYS[busiestMonth]}`)}
          description={t("cruise:stats.rhythm.seasonDesc", {
            count: detail.byMonth[busiestMonth],
          })}
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("cruise:stats.rhythm.averageNights")}
          value={detail.averageNights !== null ? detail.averageNights.toFixed(1) : "—"}
          description={t("cruise:stats.rhythm.averageNightsDesc")}
        />
        <StatCard
          accent={accent}
          valueSize="sm"
          title={t("cruise:stats.rhythm.longest")}
          value={detail.longest ? shipName(detail.longest.cruise) : "—"}
          description={
            detail.longest
              ? t("cruise:stats.rhythm.nightsCount", { count: detail.longest.nights })
              : ""
          }
        />
        <StatCard
          accent={accent}
          valueSize="sm"
          title={t("cruise:stats.rhythm.shortest")}
          value={detail.shortest ? shipName(detail.shortest.cruise) : "—"}
          description={
            detail.shortest
              ? t("cruise:stats.rhythm.nightsCount", { count: detail.shortest.nights })
              : ""
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title={t("cruise:stats.rhythm.byYear")}>
          <div className="flex gap-1.5">
            {detail.byYear.map(({ year, cruises }) => (
              <div key={year} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className="font-mono text-[10px]"
                  style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {cruises}
                </span>
                {/* The plot area is its own box. Inside a column that also
                    holds labels, a percentage height competes with them and
                    two different values come out the same height. */}
                <div className="flex w-full items-end" style={{ height: "7rem" }}>
                  <div
                    title={`${year}: ${cruises}`}
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max((cruises / maxYear) * 100, 4)}%`,
                      background: accent,
                    }}
                  />
                </div>
                <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {String(year).slice(2)}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title={t("cruise:stats.rhythm.byMonth")}>
          <div className="flex gap-1">
            {detail.byMonth.map((count, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end" style={{ height: "7rem" }}>
                  <div
                    title={`${t(`stats:months.${MONTH_KEYS[index]}`)}: ${count}`}
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max((count / maxMonth) * 100, 2)}%`,
                      background: count > 0 ? accent : "var(--color-border)",
                    }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {t(`stats:months.${MONTH_KEYS[index]}`)}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {detail.undatedCount > 0 && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("cruise:stats.rhythm.undatedNote", { count: detail.undatedCount })}
        </p>
      )}
    </section>
  );
}

/**
 * What the cruises cost, per currency.
 *
 * NEVER ONE TOTAL. A cruise carries a price and a currency and no FX snapshot —
 * unlike a flight or a lodging stay, which both store the rate they were
 * converted at. Adding 300 EUR to 400 USD and printing 700 is the defect issue
 * #267 described for flights, and having the number to hand is not a reason to
 * reproduce it. Each currency gets its own line; a per-night average only
 * exists inside one.
 */
export function CruiseMoneySection({ detail, accent }: Props): JSX.Element | null {
  const { t } = useTranslation(["cruise", "common"]);

  if (detail.spendByCurrency.length === 0) return null;

  const rows: RankedRow[] = detail.spendByCurrency.map((s) => ({
    key: s.currency,
    label: s.currency,
    weight: 1,
    value: formatCurrency(s.total, s.currency),
    hint:
      s.nights > 0
        ? t("cruise:stats.money.perNight", {
            amount: formatCurrency(s.total / s.nights, s.currency),
          })
        : t("cruise:stats.money.cruisesCount", { count: s.cruises }),
  }));

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("cruise:stats.money.title")}
      </h2>

      <RankedBarList
        title={t("cruise:stats.money.byCurrency")}
        rows={rows}
        accent={accent}
        emptyLabel={t("cruise:stats.money.none")}
      />

      <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("cruise:stats.money.coverage", {
          priced: detail.pricedCruises,
          total: detail.pricedCruises + detail.unpricedCruises,
        })}
      </p>
      {detail.spendByCurrency.length > 1 && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("cruise:stats.money.noTotalNote")}
        </p>
      )}
    </section>
  );
}

/** Firsts, records and the odd detail — the cruise counterpart to the flight fun block. */
export function CruiseFunSection({ detail, accent, locale }: Props): JSX.Element | null {
  const { t } = useTranslation(["cruise", "common"]);

  const cards: JSX.Element[] = [];

  if (detail.first) {
    cards.push(
      <StatCard
        key="first"
        accent={accent}
        valueSize="sm"
        title={t("cruise:stats.fun.first")}
        value={shipName(detail.first)}
        description={shortDate(detail.first.startDate, locale)}
      />
    );
  }

  if (detail.mostPorts) {
    cards.push(
      <StatCard
        key="ports"
        accent={accent}
        valueSize="md"
        title={t("cruise:stats.fun.mostPorts")}
        value={detail.mostPorts.ports}
        description={shipName(detail.mostPorts.cruise)}
      />
    );
  }

  if (detail.highestDeck) {
    cards.push(
      <StatCard
        key="deck"
        accent={accent}
        valueSize="md"
        title={t("cruise:stats.fun.highestDeck")}
        value={detail.highestDeck.deck}
        description={shipName(detail.highestDeck.cruise)}
      />
    );
  }

  if (detail.onTrips > 0) {
    cards.push(
      <StatCard
        key="trips"
        accent={accent}
        valueSize="md"
        title={t("cruise:stats.fun.onTrips")}
        value={detail.onTrips}
        description={t("cruise:stats.fun.onTripsDesc")}
      />
    );
  }

  const cabinRows: RankedRow[] = [...detail.cabinTypes.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([type, count], _index, all) => ({
      key: type,
      label: t(`cruise:cabinType.${type}`, { defaultValue: type }),
      weight: count / Math.max(...all.map(([, c]) => c), 1),
      value: String(count),
    }));

  const companionRows: RankedRow[] = [...detail.companions.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([name, count], _index, all) => ({
      key: name,
      label: name,
      weight: count / Math.max(...all.map(([, c]) => c), 1),
      value: String(count),
    }));

  if (cards.length === 0 && cabinRows.length === 0 && companionRows.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("cruise:stats.fun.title")}
      </h2>

      {cards.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">{cards}</div>
      )}

      {(cabinRows.length > 0 || companionRows.length > 0) && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {cabinRows.length > 0 && (
            <RankedBarList
              title={t("cruise:stats.fun.cabinTypes")}
              rows={cabinRows}
              accent={accent}
              emptyLabel={t("cruise:stats.fun.noCabins")}
            />
          )}
          {companionRows.length > 0 && (
            <RankedBarList
              title={t("cruise:stats.fun.companions")}
              rows={companionRows}
              accent={accent}
              emptyLabel={t("cruise:stats.fun.noCompanions")}
              limit={8}
              moreLabel={(hidden) => t("cruise:stats.fun.more", { count: hidden })}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
    >
      <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}
