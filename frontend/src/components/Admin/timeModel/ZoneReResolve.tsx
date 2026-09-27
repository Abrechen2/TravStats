import { useState } from "react";
import type { JSX } from "react";

import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useTranslation } from "../../../hooks/useTranslation";
import { JobLostError, jobErrorCode, type JobView } from "../../../lib/api/jobs";
import { logger } from "../../../lib/logger";
import { timeMigrationApi } from "../../../lib/api/timeMigration";
import type { ReResolveApply, ReResolveDryRun } from "../../../types/timeMigration";
import Button from "../../ui/Button";
import { columnLabel, formatOffsetDelta, tableLabel, timeModelErrorCopy } from "./timeModelCopy";

/**
 * Re-running the zone resolver over stored values (ADR 0002, D2).
 *
 * A zone is frozen with the value it belongs to, so a catalogue correction
 * does not move history. This is the deliberate way to move it: a dry run
 * lists every row whose zone the resolver would now answer differently and by
 * how much its local clock would shift; "Anwenden" sends that dry run's id and
 * nothing else, so what is written is exactly what the admin read. Both steps
 * run as server jobs and the screen follows each to its real outcome.
 *
 * A dry run the server no longer knows, and an apply whose outcome was lost,
 * drop the dry run on screen: its id is spent, and a second click on the same
 * button would only be refused — or apply twice.
 */

const SPENT_DRY_RUN_CODES = ["DRY_RUN_NOT_FOUND"];

type Progress = { done: number; total: number } | null;

type Phase =
  | { name: "idle" }
  | { name: "dryRunning"; progress: Progress }
  | { name: "reviewed"; dryRun: ReResolveDryRun }
  | { name: "applying"; dryRun: ReResolveDryRun; progress: Progress }
  | { name: "applied"; result: ReResolveApply };

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
  borderRadius: "var(--ts-radius-card)",
} as const;

const progressOf = (job: JobView<unknown>): Progress => job.progress ?? null;

export default function ZoneReResolve(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  // Kept as the error; the sentence is chosen at render time.
  const [error, setError] = useState<{ err: unknown; fallback: string } | null>(null);

  const runDryRun = async (): Promise<void> => {
    setError(null);
    setPhase({ name: "dryRunning", progress: null });
    try {
      const dryRun = await timeMigrationApi.dryRunReResolve((job) =>
        setPhase({ name: "dryRunning", progress: progressOf(job) })
      );
      setPhase({ name: "reviewed", dryRun });
    } catch (err: unknown) {
      logger.error({ err }, "ZoneReResolve: dry run failed");
      setError({ err, fallback: "admin:timeModel.reResolve.errors.dryRunFailed" });
      setPhase({ name: "idle" });
    }
  };

  const apply = async (dryRun: ReResolveDryRun, changes: number): Promise<void> => {
    const ok = await confirm({
      title: t("admin:timeModel.reResolve.confirm.title"),
      message: t("admin:timeModel.reResolve.confirm.message", { count: changes }),
      confirmText: t("admin:timeModel.reResolve.apply"),
    });
    if (!ok) return;
    setError(null);
    setPhase({ name: "applying", dryRun, progress: null });
    try {
      const result = await timeMigrationApi.applyReResolve(dryRun.dryRunId, (job) =>
        setPhase({ name: "applying", dryRun, progress: progressOf(job) })
      );
      setPhase({ name: "applied", result });
    } catch (err: unknown) {
      logger.error({ err }, "ZoneReResolve: apply failed");
      setError({ err, fallback: "admin:timeModel.reResolve.errors.applyFailed" });
      // A lost job may have written everything: re-applying the same id is
      // not the way to find out, a fresh dry run is.
      const code = jobErrorCode(err);
      const spent =
        err instanceof JobLostError || (code !== null && SPENT_DRY_RUN_CODES.includes(code));
      setPhase(spent ? { name: "idle" } : { name: "reviewed", dryRun });
    }
  };

  const busy = phase.name === "dryRunning" || phase.name === "applying";

  return (
    <div className="flex flex-col gap-4 p-6" style={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {t("admin:timeModel.reResolve.title")}
          </h3>
          <p className="t-caption mt-1">{t("admin:timeModel.reResolve.description")}</p>
        </div>
        <Button onClick={() => void runDryRun()} disabled={busy}>
          {phase.name === "dryRunning"
            ? t("admin:timeModel.reResolve.dryRunning")
            : t("admin:timeModel.reResolve.dryRun")}
        </Button>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--ts-bad)", fontWeight: 600 }}>
          {timeModelErrorCopy(error.err, t, error.fallback)}
        </p>
      )}

      {phase.name === "dryRunning" && <ProgressLine progress={phase.progress} />}

      {(phase.name === "reviewed" || phase.name === "applying") && (
        <DryRunResult
          dryRun={phase.dryRun}
          applying={phase.name === "applying"}
          progress={phase.name === "applying" ? phase.progress : null}
          onApply={(changes) => void apply(phase.dryRun, changes)}
        />
      )}

      {phase.name === "applied" && (
        <p role="status">
          {t("admin:timeModel.reResolve.applied", {
            applied: phase.result.applied,
            skipped: phase.result.skippedChanged,
          })}
        </p>
      )}
      {confirmDialog}
    </div>
  );
}

function ProgressLine({ progress }: { progress: Progress }): JSX.Element {
  const { t } = useTranslation(["admin"]);
  return (
    <span className="t-caption" role="status">
      {progress
        ? t("admin:timeModel.reResolve.progress", { done: progress.done, total: progress.total })
        : t("admin:timeModel.reResolve.progressUnknown")}
    </span>
  );
}

function DryRunResult({
  dryRun,
  applying,
  progress,
  onApply,
}: {
  dryRun: ReResolveDryRun;
  applying: boolean;
  progress: Progress;
  onApply: (changes: number) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const sum = (key: "checked" | "changes" | "unresolvable"): number =>
    dryRun.tables.reduce((acc, row) => acc + row[key], 0);
  const changes = sum("changes");
  const unresolvable = sum("unresolvable");

  return (
    <div className="flex flex-col gap-3">
      <p>
        {t("admin:timeModel.reResolve.summary", {
          checked: sum("checked"),
          changes,
          tzdata: dryRun.tzdata ?? "—",
        })}
      </p>
      {unresolvable > 0 && (
        <p className="t-caption">
          {t("admin:timeModel.reResolve.unresolvable", { count: unresolvable })}
        </p>
      )}

      {changes === 0 ? (
        <p>{t("admin:timeModel.reResolve.noChanges")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--ts-muted)" }}>
                  <th className="py-1 pr-3 text-left">
                    {t("admin:timeModel.reResolve.table.entry")}
                  </th>
                  <th className="py-1 pr-3 text-left">
                    {t("admin:timeModel.reResolve.table.from")}
                  </th>
                  <th className="py-1 pr-3 text-left">{t("admin:timeModel.reResolve.table.to")}</th>
                  <th className="py-1 text-right">{t("admin:timeModel.reResolve.table.delta")}</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.changes.map((c) => (
                  <tr
                    key={`${c.table}|${c.rowId}|${c.column}`}
                    style={{ borderTop: "1px solid var(--ts-border)" }}
                  >
                    <td className="py-1 pr-3">
                      <div>
                        {tableLabel(t, c.table)} · {columnLabel(t, c.column)}
                      </div>
                      <div className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                        {c.rowId}
                      </div>
                    </td>
                    <td className="py-1 pr-3" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {c.storedZone}
                    </td>
                    <td className="py-1 pr-3" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {c.resolvedZone}
                    </td>
                    <td className="py-1 text-right" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {formatOffsetDelta(c.offsetDeltaMinutes, t)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dryRun.changesTruncated && (
            <p className="t-caption">
              {t("admin:timeModel.reResolve.truncated", {
                shown: dryRun.changes.length,
                total: changes,
              })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => onApply(changes)} disabled={applying}>
              {applying
                ? t("admin:timeModel.reResolve.applying")
                : t("admin:timeModel.reResolve.apply")}
            </Button>
            {applying && <ProgressLine progress={progress} />}
          </div>
        </>
      )}
    </div>
  );
}
