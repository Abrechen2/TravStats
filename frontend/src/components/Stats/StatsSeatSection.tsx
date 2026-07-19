import type { SeatStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface StatsSeatSectionProps {
  seatStats: SeatStats | null;
}

export default function StatsSeatSection({ seatStats }: StatsSeatSectionProps): JSX.Element | null {
  const { t } = useTranslation(["stats"]);

  if (!seatStats) return null;

  const hasData =
    seatStats.windowCount + seatStats.middleCount + seatStats.aisleCount + seatStats.unknownCount >
    0;

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:seats.title")}
      </h2>

      {hasData ? (
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Position distribution */}
            <div>
              <h3 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                Window / Middle / Aisle
              </h3>
              {[
                {
                  label: t("stats:seats.window"),
                  count: seatStats.windowCount,
                  color: "bg-blue-500",
                },
                {
                  label: t("stats:seats.middle"),
                  count: seatStats.middleCount,
                  color: "bg-yellow-500",
                },
                {
                  label: t("stats:seats.aisle"),
                  count: seatStats.aisleCount,
                  color: "bg-green-500",
                },
              ].map((item) => {
                const total = seatStats.windowCount + seatStats.middleCount + seatStats.aisleCount;
                const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                return (
                  <div key={item.label} className="mb-2">
                    <div
                      className="flex justify-between text-sm mb-1"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>{item.label}</span>
                      <span>
                        {item.count} ({pct}%)
                      </span>
                    </div>
                    <div
                      className="w-full rounded-full h-2"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className={`${item.color} h-2 rounded-full`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Zone distribution */}
            <div>
              <h3 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                Front / Middle / Back
              </h3>
              {/* Front/Middle/Back chart bars previously used purple/indigo/
                  pink which leak Hotel-domain (purple) and non-brand hues
                  (indigo, pink) into a flight stat. Per BRAND.md §3 those
                  domain colours stay in their domain and pink/indigo aren't
                  in the brand palette at all. Use brand-amber graded by
                  zone position so the eye still differentiates the three
                  bars (front = strong, middle = mid, back = soft). */}
              {[
                {
                  label: t("stats:seats.front"),
                  count: seatStats.frontCount,
                  color: "bg-(--accent)",
                },
                {
                  label: t("stats:seats.middleZone"),
                  count: seatStats.middleZoneCount,
                  color: "bg-(--accent-dim)",
                },
                {
                  label: t("stats:seats.back"),
                  count: seatStats.backCount,
                  color: "bg-(--accent-soft)",
                },
              ].map((item) => {
                const total =
                  seatStats.frontCount + seatStats.middleZoneCount + seatStats.backCount;
                const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                return (
                  <div key={item.label} className="mb-2">
                    <div
                      className="flex justify-between text-sm mb-1"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>{item.label}</span>
                      <span>
                        {item.count} ({pct}%)
                      </span>
                    </div>
                    <div
                      className="w-full rounded-full h-2"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className={`${item.color} h-2 rounded-full`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Most common seat + avg row */}
            <div className="flex flex-col gap-3">
              {seatStats.mostCommonSeat && (
                <div
                  className="p-4 rounded-lg"
                  style={{
                    background: "var(--bg-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("stats:seats.mostCommon")}
                  </p>
                  <p className="text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                    {seatStats.mostCommonSeat}
                  </p>
                </div>
              )}
              {seatStats.avgRowNumber !== null && (
                <div
                  className="p-4 rounded-lg"
                  style={{
                    background: "var(--bg-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("stats:seats.avgRow")}
                  </p>
                  <p className="text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                    {seatStats.avgRowNumber}
                  </p>
                </div>
              )}
            </div>

            {/* Seat class distribution */}
            {Object.keys(seatStats.seatClassDistribution).length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  {t("stats:seats.seatClassTitle")}
                </h3>
                {Object.entries(seatStats.seatClassDistribution).map(([cls, count]) => {
                  const total = Object.values(seatStats.seatClassDistribution).reduce(
                    (a, b) => a + b,
                    0
                  );
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={cls} className="mb-2">
                      <div
                        className="flex justify-between text-sm mb-1"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <span className="capitalize">{cls.replace(/_/g, " ")}</span>
                        <span>
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div
                        className="w-full rounded-full h-2"
                        style={{ background: "var(--color-border)" }}
                      >
                        <div
                          className="h-2 rounded-full"
                          style={{ width: `${pct}%`, background: "var(--accent)" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg shadow-sm p-6 text-center"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p style={{ color: "var(--text-muted)" }}>{t("stats:seats.noData")}</p>
        </div>
      )}
    </div>
  );
}
