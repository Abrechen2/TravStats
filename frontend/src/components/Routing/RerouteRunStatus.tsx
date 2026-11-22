import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { RerouteRun } from "../../lib/api/rerouteRuns";
import Button from "../ui/Button";

/** The reasons a line was kept, in the order they are worth reading. */
const REASON_ORDER = [
  "rate_limited",
  "no_route",
  "point_not_near_road",
  "untrustworthy",
  "provider_error",
  "timeout",
  "auth",
  "no_provider",
  "no_coordinates",
  "changed",
  "unroutable_mode",
];

/**
 * One run's progress and outcome, in words: the counts, why lines were kept as
 * they were (each reason its own sentence — never a bare "done"), and, for a
 * run that met the provider's quota, when it goes on by itself. Shared by the
 * administrator's row and the roadtrip's ⋯.
 */
export default function RerouteRunStatus({
  run,
  onCancel,
  testId,
}: {
  run: RerouteRun;
  onCancel: () => void;
  testId: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["routing"]);
  const active = run.status === "running" || run.status === "paused";
  const reasons = Object.entries(run.failureCounts).sort(
    ([a], [b]) => (REASON_ORDER.indexOf(a) + 1 || 99) - (REASON_ORDER.indexOf(b) + 1 || 99)
  );
  const percent = run.total > 0 ? Math.min(100, Math.round((run.processed / run.total) * 100)) : 0;
  const resume = run.resumeAfter
    ? new Date(run.resumeAfter).toLocaleString(i18n.language, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="flex flex-col" style={{ gap: 6 }} data-testid={testId}>
      <p className="t-caption" role="status">
        {t(`routing:run.status.${run.status}`, {
          processed: run.processed,
          total: run.total,
          routed: run.routed,
          kept: run.kept,
        })}
        {run.status === "paused" && resume ? ` ${t("routing:run.resumeAt", { at: resume })}` : ""}
        {run.stopReason && (run.status === "failed" || run.status === "paused")
          ? ` ${t(`routing:run.stop.${run.stopReason}`, { defaultValue: "" })}`
          : ""}
      </p>
      {active && run.total > 0 && (
        <div
          role="progressbar"
          aria-label={t("routing:run.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ maxWidth: 360, height: 6, borderRadius: 999, background: "var(--ts-surface2)" }}
        >
          <div
            style={{
              width: `${Math.max(percent, 1)}%`,
              height: "100%",
              borderRadius: 999,
              background: "var(--ts-accent)",
            }}
          />
        </div>
      )}
      {reasons.length > 0 && (
        <ul className="t-caption" style={{ margin: 0, paddingLeft: 18 }}>
          {reasons.map(([reason, count]) => (
            <li key={reason}>
              {t(`routing:run.reason.${reason}`, { count, defaultValue: reason })}
            </li>
          ))}
        </ul>
      )}
      {active && (
        <div>
          <Button variant="secondary" onClick={onCancel}>
            {t("routing:run.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
