import type { JSX } from "react";
import { useEffect, useState } from "react";
import { statsApi } from "../../../lib/api/stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import type { TravelAccountResponse, TravelAccountYear } from "../../../types/travelAccount";
import StatCard from "../StatCard";

/** One colour per bucket — the domain tokens, plus a muted one for home. */
const BUCKETS = [
  { key: "hotelNights", colour: "var(--domain-lodging, #d4778f)" },
  { key: "seaNights", colour: "var(--domain-cruise, #6fa0d6)" },
  { key: "airNights", colour: "var(--domain-flight, #f0a947)" },
  { key: "homeNights", colour: "var(--color-border)" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

/**
 * The travel account — the question the lodging domain made answerable.
 *
 * With flights alone you can say how far someone went; with cruises you can add
 * how long they were at sea. Only once hotel nights are recorded can a year be
 * closed out: so many nights in a bed away from home, so many at sea, so many
 * in a seat, and the rest at home. The bar is a full year every time, which is
 * what makes "you were away 14 % of 2025" legible without a second figure.
 */
export default function TravelAccountSection(): JSX.Element | null {
  const { t } = useTranslation(["stats", "common"]);
  const [data, setData] = useState<TravelAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await statsApi.getTravelAccount();
        if (!cancelled) setData(result);
      } catch (err) {
        logger.error("TravelAccountSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="mt-8 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("common:loading.default")}
      </p>
    );
  }
  // A failed sub-section renders nothing rather than an error card: the rest of
  // the overview is still correct, and a red box next to correct figures reads
  // as if they were affected.
  if (failed || data === null || data.account.years.length === 0) return null;

  const { account, trips } = data;

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("stats:travelAccount.title")}
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("stats:travelAccount.subtitle")}
        {account.contestedNights > 0 &&
          ` · ${t("stats:travelAccount.contested", { count: account.contestedNights })}`}
      </p>

      <div className="flex flex-col gap-3">
        {account.years.map((year) => (
          <YearBar key={year.year} year={year} label={(key) => t(`stats:travelAccount.${key}`)} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        {BUCKETS.map((bucket) => (
          <span key={bucket.key} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: bucket.colour }}
            />
            <span style={{ color: "var(--text-muted)" }}>
              {t(`stats:travelAccount.${bucket.key}`)}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          valueSize="md"
          title={t("stats:travelAccount.tripsCovered")}
          value={`${trips.fullyCoveredTrips} / ${trips.tripsWithDates}`}
          description={t("stats:travelAccount.tripsCoveredDesc")}
        />
        <StatCard
          valueSize="md"
          title={t("stats:travelAccount.uncoveredDays")}
          value={trips.totalUncoveredDays}
          description={t("stats:travelAccount.uncoveredDaysDesc")}
        />
        <StatCard
          valueSize="md"
          title={t("stats:travelAccount.avgTripDays")}
          value={trips.avgTripDays ?? "—"}
          description={t("stats:travelAccount.avgTripDaysDesc", {
            count: trips.longestTripDays ?? 0,
          })}
        />
        <StatCard
          valueSize="md"
          title={t("stats:travelAccount.journalEntries")}
          value={trips.journalEntries}
          description={
            trips.moods.length > 0
              ? trips.moods
                  .slice(0, 3)
                  .map((m) => `${m.key} ${m.count}`)
                  .join(" · ")
              : t("stats:travelAccount.noMoods")
          }
        />
      </div>
    </section>
  );
}

/** A single year as one full-width bar. The width IS the year, so the buckets are read as shares. */
function YearBar({
  year,
  label,
}: {
  year: TravelAccountYear;
  label: (key: BucketKey) => string;
}): JSX.Element {
  const awayNights = year.hotelNights + year.seaNights + year.airNights;
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-12 shrink-0 text-sm"
        style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
      >
        {year.year}
      </span>
      <div className="flex h-5 flex-1 overflow-hidden rounded" style={{ background: "var(--color-border)" }}>
        {BUCKETS.map((bucket) => {
          const nights = year[bucket.key];
          if (nights === 0) return null;
          return (
            <div
              key={bucket.key}
              // `days` is never 0 for a year that made it into the payload, so
              // no guard is needed — but the title is, because a 2-night sliver
              // is unreadable without one.
              style={{ width: `${(nights / year.days) * 100}%`, background: bucket.colour }}
              title={`${label(bucket.key)}: ${nights}`}
            />
          );
        })}
      </div>
      <span
        className="w-16 shrink-0 text-right text-sm"
        style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
      >
        {((awayNights / year.days) * 100).toFixed(0)} %
      </span>
    </div>
  );
}
