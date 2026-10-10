import { useCallback, useState } from "react";
import type { JSX } from "react";
import { isAxiosError } from "axios";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { logger } from "../../lib/logger";
import { resolvePlaceImport } from "../../lib/api/placeImport";
import { JobLostError } from "../../lib/api/jobs";
import { summarizeResolution, type ResolutionSummary } from "../../lib/placeImportTakeout";
import type { PlaceImportCandidate, PlaceImportResolution } from "../../types/placeImport";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  /** The rows to resolve (`rowsToResolve`). The panel hides when empty. */
  rows: PlaceImportCandidate[];
  /** The list's name — Takeout names the file after it. */
  listName: string | null;
  onResolved: (resolution: PlaceImportResolution) => void;
  t: Translate;
}

type Failure = "lost" | "rateLimited" | "failed";

/**
 * "Resolve this Google Maps list" above the place import preview (#358).
 *
 * A button, not an automatic call: the lookup spends the instance's Google
 * quota, and the user should choose to spend it. While it runs it shows how
 * far it got; afterwards it states what was found and — the part that matters —
 * why the rest was not, so a refused key or an exhausted quota reaches the
 * user as itself rather than as rows that quietly stayed empty.
 */
export function TakeoutResolvePanel({ rows, listName, onResolved, t }: Props): JSX.Element | null {
  const coarse = useCoarsePointer();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<{
    resolution: PlaceImportResolution;
    summary: ResolutionSummary;
  } | null>(null);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setFailure(null);
    setProgress(null);
    try {
      const resolution = await resolvePlaceImport(
        listName,
        rows.map((r) => ({
          sourceRowIndex: r.sourceRowIndex,
          name: r.name,
          externalRef: r.externalRef ?? null,
          lat: r.lat ?? null,
          lon: r.lon ?? null,
        })),
        setProgress
      );
      setResult({ resolution, summary: summarizeResolution(resolution) });
      onResolved(resolution);
    } catch (err) {
      logger.error("TakeoutResolvePanel: resolving the list failed", err);
      if (err instanceof JobLostError) setFailure("lost");
      else if (isAxiosError(err) && err.response?.status === 429) setFailure("rateLimited");
      else setFailure("failed");
    } finally {
      setRunning(false);
    }
  }, [listName, rows, onResolved]);

  if (rows.length === 0 && !result) return null;

  return (
    <div
      data-testid="takeout-resolve-panel"
      className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--bg-base)] p-3 text-sm"
    >
      {!result && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[var(--text-muted)]">
            {t("places:import.takeout.intro", { count: rows.length })}
          </p>
          <button
            type="button"
            data-testid="takeout-resolve"
            onClick={(): void => void run()}
            disabled={running}
            className={`btn-primary px-3 text-sm disabled:opacity-50 ${coarse ? "min-h-11" : "py-1.5"}`}
          >
            {running
              ? t("places:import.takeout.running", {
                  done: progress?.done ?? 0,
                  total: progress?.total ?? rows.length,
                })
              : t("places:import.takeout.resolve")}
          </button>
        </div>
      )}
      {failure && (
        <p role="alert" className="mt-2 text-(--danger)">
          {t(`places:import.takeout.errors.${failure}`)}
        </p>
      )}
      {result && <ResolutionSummaryView {...result} t={t} />}
    </div>
  );
}

function ResolutionSummaryView({
  resolution,
  summary,
  t,
}: {
  resolution: PlaceImportResolution;
  summary: ResolutionSummary;
  t: Translate;
}): JSX.Element {
  const listReason = (r: { reason: string; count: number }): string =>
    `${r.count}× ${t(`places:import.takeout.positionReasons.${r.reason}`)}`;

  return (
    <div data-testid="takeout-summary" className="space-y-1 text-[var(--text-muted)]">
      <p>
        {summary.google} {t("places:import.takeout.summary.google")}
        {" · "}
        {summary.byName} {t("places:import.takeout.summary.byName")}
        {" · "}
        {summary.unplaced} {t("places:import.takeout.summary.unplaced")}
        {" · "}
        {summary.datedFromPhotos} {t("places:import.takeout.summary.dated")}
      </p>
      <p data-testid="takeout-trip">
        {resolution.trip
          ? t("places:import.takeout.trip.found", { name: resolution.trip.name })
          : t(`places:import.takeout.trip.${resolution.tripReason ?? "no_trip"}`)}
      </p>
      {!resolution.googleConfigured && (
        <p data-testid="takeout-no-key" className="text-(--warning)/90">
          {t("places:import.takeout.noKey")}
        </p>
      )}
      {summary.googleFailures.length > 0 && (
        <p data-testid="takeout-google-failures" className="text-(--warning)/90">
          {t("places:import.takeout.googleFailed")}{" "}
          {summary.googleFailures.map((r) => listReason(r)).join(", ")}
        </p>
      )}
      {summary.reasons.length > 0 && (
        <p data-testid="takeout-unplaced-reasons">
          {t("places:import.takeout.unplacedBecause")}{" "}
          {summary.reasons.map((r) => listReason(r)).join(", ")}
        </p>
      )}
    </div>
  );
}
