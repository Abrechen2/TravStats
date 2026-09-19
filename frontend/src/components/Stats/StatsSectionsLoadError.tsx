import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";

/**
 * Said once, when the ONE composed statistics request fails (forgejo#49).
 *
 * Nine sections share a single `/stats/page` load, so one failure takes all
 * nine. That is the right trade — nine separate failures of the same query were
 * nine chances to draw a page that was partly wrong without saying so — but it
 * only holds if the page SAYS so. Before this, a failed load left nine cards
 * reading "loading" with no explanation anywhere.
 *
 * The retry is not decoration either: without it the only way back is a full
 * page reload, which throws away the flight list, the summary and the
 * timeseries that all succeeded. Same shape as the cruise section's load error
 * (`CruiseStatsSection`), same retry pattern as the dashboard's POI tab.
 */
export interface StatsSectionsLoadErrorProps {
  onRetry: () => void;
}

export default function StatsSectionsLoadError({
  onRetry,
}: StatsSectionsLoadErrorProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  return (
    <div
      className="rounded-lg p-4 mb-6"
      role="alert"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--danger)",
        color: "var(--danger)",
      }}
    >
      <p className="text-sm">
        {t("stats:page.loadError")}{" "}
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginLeft: 8,
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {t("stats:page.retry")}
        </button>
      </p>
    </div>
  );
}
