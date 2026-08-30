import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import RankedBarList from "./RankedBarList";

const LODGING_ACCENT = "var(--domain-lodging, #d4778f)";
const LIST_LIMIT = 8;

interface Props {
  stats: LodgingStats;
}

/**
 * Brand loyalty and programme status.
 *
 * The programme table is the one with real-world value: hotel programmes count
 * status in nights per CALENDAR year, so that is the shape it is presented in —
 * not as a lifetime total, which no programme has ever cared about.
 *
 * The concentration index is deliberately shown next to the plain
 * chain-vs-independent split. On its own, a high concentration reads as "very
 * loyal" even for someone who stays in chains twice a year and sleeps in
 * guesthouses the rest of the time.
 */
export default function LodgingLoyaltySection({ stats }: Props): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  const { loyalty } = stats;
  const totalNights = loyalty.chainNights + loyalty.independentNights;

  const percent = (value: number | null): string =>
    value === null ? "—" : `${(value * 100).toFixed(0)} %`;

  // One entry per programme that has a tier at all, in the order the years
  // arrive. A programme appears on several year rows; its tier is one value.
  const currentTiers = loyalty.programmeYears.reduce<Array<{ programme: string; tier: string }>>(
    (acc, row) => {
      if (!row.tier) return acc;
      if (acc.some((seen) => seen.programme === row.programme)) return acc;
      return [...acc, { programme: row.programme, tier: row.tier }];
    },
    []
  );

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.loyalty.title")}
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.loyalty.chainShare")}
          value={totalNights > 0 ? percent(loyalty.chainNights / totalNights) : "—"}
          description={t("lodging:stats.loyalty.chainShareDesc", {
            chain: loyalty.chainNights,
            independent: loyalty.independentNights,
          })}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.loyalty.topChain")}
          value={loyalty.topChain?.name ?? "—"}
          description={
            loyalty.topChain
              ? t("lodging:stats.loyalty.topChainDesc", { count: loyalty.topChain.nights })
              : t("lodging:stats.loyalty.noChains")
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.loyalty.topChainShare")}
          value={percent(loyalty.topChainShare)}
          description={t("lodging:stats.loyalty.topChainShareDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.loyalty.concentration")}
          value={loyalty.concentration !== null ? loyalty.concentration.toFixed(2) : "—"}
          description={t("lodging:stats.loyalty.concentrationDesc")}
          footnote={t("lodging:stats.loyalty.concentrationFootnote")}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title={t("lodging:stats.loyalty.byChain")}
          accent={LODGING_ACCENT}
          rows={loyalty.chainNightsRanked.map((c) => ({
            key: c.key,
            label: c.key,
            weight: c.nights,
            value: t("lodging:stats.geo.nights", { count: c.nights }),
            hint: t("lodging:stats.geo.stays", { count: c.stays }),
          }))}
          emptyLabel={t("lodging:stats.loyalty.noChains")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />

        <div
          className="rounded-lg border p-5"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--color-border)",
            color: "var(--text-primary)",
          }}
        >
          <h3 className="mb-3 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("lodging:stats.loyalty.programmeYears")}
          </h3>
          {/* The tier belongs to the CARD, not to a year — the backend type says
              so in as many words. Printed beside every year it claimed a status
              that may not have existed then, and there is no dated history to
              draw a truthful per-year value from. So it is said once, here,
              about now. */}
          {currentTiers.length > 0 && (
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {t("lodging:stats.loyalty.currentTier")}{" "}
              {currentTiers.map((entry) => `${entry.programme} ${entry.tier}`).join(" · ")}
            </p>
          )}
          {loyalty.programmeYears.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("lodging:stats.loyalty.noProgrammes")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="pb-2 text-left font-normal">
                    {t("lodging:stats.loyalty.programme")}
                  </th>
                  <th className="pb-2 text-left font-normal">{t("lodging:stats.loyalty.year")}</th>
                  <th className="pb-2 text-right font-normal">
                    {t("lodging:stats.loyalty.nights")}
                  </th>
                  <th className="pb-2 text-right font-normal">
                    {t("lodging:stats.loyalty.stays")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loyalty.programmeYears.map((row) => (
                  <tr key={`${row.programme}-${row.year}`}>
                    <td className="py-1">{row.programme}</td>
                    <td className="py-1">{row.year}</td>
                    <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {row.nights}
                    </td>
                    <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {row.stays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
