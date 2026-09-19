// Small inline pill that shows year-over-year delta with an arrow + percent.
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { ComparisonKind } from "../../../lib/stats/comparisonWindow";
import type { DeltaInfo } from "./aggregate";

interface Props {
  d: DeltaInfo | null;
  compareYear: number | null;
  /**
   * Which span the number behind this pill was measured over. The label has to
   * travel with it: a same-period delta under "ggü. 2025" would be a second,
   * quieter lie than the unequal comparison it replaced — the reader would
   * take it for the whole year and it is eight months.
   */
  kind?: ComparisonKind;
}

export default function DeltaBadge({
  d,
  compareYear,
  kind = "fullYear",
}: Props): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  if (!d || compareYear === null) return null;
  const arrow = d.sign === "up" ? "↑" : d.sign === "down" ? "↓" : "→";
  const sign = d.diff > 0 ? "+" : "";
  const bg =
    d.sign === "up"
      ? "rgba(63, 185, 80, 0.18)"
      : d.sign === "down"
        ? "rgba(248, 81, 73, 0.18)"
        : "var(--bg-elevated)";
  const fg =
    d.sign === "up" ? "var(--success)" : d.sign === "down" ? "var(--danger)" : "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold font-mono mt-1.5"
      style={{ background: bg, color: fg }}
    >
      {arrow} {sign}
      {d.diff}
      {d.pct !== null && (
        <span>
          ({sign}
          {d.pct}%)
        </span>
      )}
      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
        {t(kind === "samePeriod" ? "stats:yearFilter.vsSamePeriod" : "stats:yearFilter.vs", {
          year: compareYear,
        })}
      </span>
    </span>
  );
}
