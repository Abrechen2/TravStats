import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import RankedBarList from "./RankedBarList";

const LODGING_ACCENT = "var(--domain-lodging, #d4778f)";

/** i18n keys, in the order the backend array uses: index 0 = Sunday. */
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const SEASON_KEYS = ["winter", "spring", "summer", "autumn"] as const;

interface Props {
  stats: LodgingStats;
}

/**
 * When the nights happened.
 *
 * The weekday histogram is the quiet one worth keeping: a check-in profile
 * that peaks Sunday-to-Thursday is a working life, one that peaks Friday and
 * Saturday is not, and neither needs the user to tick a "business" box.
 *
 * The week is rendered starting on MONDAY even though the backend array starts
 * on Sunday — that array mirrors `Date.getUTCDay()` and re-basing it there
 * would put two conventions in one payload. The rotation belongs where the
 * week is read, which is here.
 */
export default function LodgingRhythmSection({ stats }: Props): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  const { rhythm } = stats;

  const weekdayRows = [1, 2, 3, 4, 5, 6, 0].map((idx) => ({
    key: WEEKDAY_KEYS[idx],
    label: t(`lodging:stats.rhythm.weekday.${WEEKDAY_KEYS[idx]}`),
    weight: rhythm.nightsByWeekday[idx] ?? 0,
    value: String(rhythm.nightsByWeekday[idx] ?? 0),
    hint: null,
  }));

  const seasonRows = SEASON_KEYS.map((key) => ({
    key,
    label: t(`lodging:stats.rhythm.season.${key}`),
    weight: rhythm.nightsBySeason[key],
    value: String(rhythm.nightsBySeason[key]),
    hint: null,
  }));

  const shareRows = Object.entries(rhythm.awayShareByYear)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, share]) => ({
      key: year,
      label: year,
      weight: share,
      value: `${(share * 100).toFixed(1)} %`,
      hint: null,
    }));

  const overlapNights = stats.totalNights - rhythm.nightsAway;

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.rhythm.title")}
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.rhythm.nightsAway")}
          value={rhythm.nightsAway}
          description={t("lodging:stats.rhythm.nightsAwayDesc")}
          // Only worth saying when it differs — otherwise it is noise under
          // every single account that never double-booked.
          footnote={
            overlapNights > 0
              ? t("lodging:stats.rhythm.overlap", { count: overlapNights })
              : undefined
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.rhythm.longestStreak")}
          value={rhythm.longestStreakNights}
          description={
            rhythm.longestStreak
              ? t("lodging:stats.rhythm.longestStreakDesc", {
                  start: rhythm.longestStreak.start,
                  end: rhythm.longestStreak.end,
                })
              : t("lodging:stats.rhythm.noNights")
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.rhythm.longestGap")}
          value={rhythm.longestGapDays}
          description={t("lodging:stats.rhythm.longestGapDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.rhythm.busiestMonth")}
          value={busiestMonthLabel(rhythm.nightsByMonthOfYear, t)}
          description={t("lodging:stats.rhythm.busiestMonthDesc")}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RankedBarList
          title={t("lodging:stats.rhythm.byWeekday")}
          accent={LODGING_ACCENT}
          rows={weekdayRows}
          emptyLabel={t("lodging:stats.rhythm.noNights")}
        />
        <RankedBarList
          title={t("lodging:stats.rhythm.bySeason")}
          accent={LODGING_ACCENT}
          rows={seasonRows}
          emptyLabel={t("lodging:stats.rhythm.noNights")}
        />
        <RankedBarList
          title={t("lodging:stats.rhythm.awayShare")}
          accent={LODGING_ACCENT}
          rows={shareRows}
          emptyLabel={t("lodging:stats.rhythm.noNights")}
        />
      </div>
    </section>
  );
}

/**
 * The month with the most nights across all years. Ties go to the earlier
 * month — arbitrary, but stable, which matters more than which January wins.
 */
function busiestMonthLabel(
  nightsByMonthOfYear: number[],
  t: (key: string) => string,
): string {
  let best = -1;
  let bestCount = 0;
  nightsByMonthOfYear.forEach((count, idx) => {
    if (count > bestCount) {
      bestCount = count;
      best = idx;
    }
  });
  return best === -1 ? "—" : t(`lodging:stats.rhythm.month.${best}`);
}
