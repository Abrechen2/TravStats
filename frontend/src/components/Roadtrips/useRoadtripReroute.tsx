import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { roadtripRerouteApi } from "../../lib/api/rerouteRuns";
import RerouteRunStatus from "../Routing/RerouteRunStatus";
import { useRerouteRun } from "../Routing/useRerouteRun";
import type { OverflowEntry } from "../ui/OverflowMenu";
import InlineError from "../ui/InlineError";

/**
 * "Alle Etappen neu routen" in the roadtrip's ⋯ (forgejo#436): the account's own
 * legs of this roadtrip, through the same resumable run as the administrator's
 * pass, on the account's own share of the daily quota. A drawn or recorded leg
 * is never replaced and a failed answer keeps the stored line. `panel` (progress,
 * reasons, cancel) renders under the header, outside the closed menu.
 */
export function useRoadtripReroute(
  routeId: string,
  /** Reloads the page's roadtrip once the run has ended: the legs it routed are new geometry. */
  onEnded: () => void
): {
  entry: OverflowEntry;
  panel: JSX.Element | null;
} {
  const { t } = useTranslation(["routing"]);
  const { run, error, busy, start, cancel } = useRerouteRun(
    {
      read: () => roadtripRerouteApi.latest(routeId),
      start: () => roadtripRerouteApi.start(routeId),
      cancel: roadtripRerouteApi.cancel,
    },
    // The page only offers the action; a run already going is shown by the
    // refused start (`alreadyActive`), so opening a roadtrip costs no request.
    false,
    onEnded
  );
  const active = run?.status === "running" || run?.status === "paused";
  return {
    entry: {
      key: "reroute",
      label: active ? t("routing:roadtrip.running") : t("routing:roadtrip.action"),
      disabled: busy || active,
      onSelect: () => void start(),
    },
    panel:
      error || run ? (
        <div style={{ marginTop: "var(--ts-space-sm)" }} data-testid="roadtrip-reroute">
          {error && error !== "loadFailed" && (
            <InlineError>{t(`routing:roadtrip.${error}`)}</InlineError>
          )}
          {run && (
            <RerouteRunStatus
              run={run}
              onCancel={() => void cancel()}
              testId="roadtrip-reroute-run"
            />
          )}
        </div>
      ) : null,
  };
}
