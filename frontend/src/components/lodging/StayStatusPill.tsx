import type { CSSProperties, JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { StayStatus } from "../../types/lodging";

/**
 * Lifecycle status pill for stays and lodging rows — the same visual idiom
 * as the flights table's status pill (FlightsTablePage), so the domain list
 * pages read as one family: green = done, blue = booked, accent = running,
 * red = cancelled.
 */
const PILL_STYLE: Record<StayStatus, CSSProperties> = {
  completed: { background: "rgba(63,185,80,0.15)", color: "var(--success)" },
  scheduled: { background: "rgba(56,139,253,0.15)", color: "#388bfd" },
  in_progress: { background: "rgba(240,169,71,0.18)", color: "var(--accent)" },
  cancelled: { background: "rgba(248,81,73,0.15)", color: "var(--danger)" },
};

export function StayStatusPill({
  status,
  testId,
}: {
  status: StayStatus;
  testId?: string;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  return (
    <span
      data-testid={testId}
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={PILL_STYLE[status]}
    >
      {t(`lodging:stayStatus.${status}`)}
    </span>
  );
}
