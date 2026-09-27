import { useState } from "react";
import type { JSX } from "react";

import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useTranslation } from "../../../hooks/useTranslation";
import { JobLostError, jobErrorCode } from "../../../lib/api/jobs";
import { logger } from "../../../lib/logger";
import { timeMigrationApi } from "../../../lib/api/timeMigration";
import type { ZoneReResolveApplyResult, ZoneReResolveDryRun } from "../../../types/timeMigration";
import Button from "../../ui/Button";
import { fieldLabel, formatOffsetDelta, tableLabel, timeModelErrorCopy } from "./timeModelCopy";

/**
 * Re-running the zone resolver over stored values (ADR 0002, D2).
 *
 * A zone is frozen with the value it belongs to, so a catalogue correction
 * does not move history. This is the deliberate way to move it: a dry run
 * lists every row whose zone the resolver would now answer differently and by
 * how much its local clock would shift; "Anwenden" sends that dry run's id and
 * nothing else, so what is written is exactly what the admin read. The apply
 * runs as a job — it can outlast any request — and the screen follows it to
 * its real outcome.
 *
 * Refusals the server can give (the dry run expired, or the data moved under
 * it) drop the dry run on screen: its id is spent, and a second click on the
 * same button would only be refused again.
 */

const SPENT_DRY_RUN_CODES = ["DRY_RUN_NOT_FOUND", "DRY_RUN_EXPIRED", "DRY_RUN_STALE"];

type Phase =
  | { name: "idle" }
  | { name: "dryRunning" }
  | { name: "reviewed"; dryRun: ZoneReResolveDryRun }
  | {
      name: "applying";
      dryRun: ZoneReResolveDryRun;
      progress: { done: number; total: number } | null;
    }
  | { name: "applied"; result: ZoneReResolveApplyResult };

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
  borderRadius: "var(--ts-radius-card)",
} as const;

export default function ZoneReResolve(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async (): Promise<void> => {
    setError(null);
    setPhase({ name: "dryRunning" });
    try {
      setPhase({ name: "reviewed", dryRun: await timeMigrationApi.dryRunReResolve() });
    } catch (err: unknown) {
      logger.error({ err }, "ZoneReResolve: dry run failed");
      setError(timeModelErrorCopy(err, t, "admin:timeModel.reResolve.errors.dryRunFailed"));
      setPhase({ name: "idle" });
    }
  };

  const apply = async (dryRun: ZoneReResolveDryRun): Promise<void> => {
    const ok = await confirm({
      title: t("admin:timeModel.reResolve.confirm.title"),
      message: t("admin:timeModel.reResolve.confirm.message", { count: dryRun.changesTotal }),
      confirmText: t("admin:timeModel.reResolve.apply"),
    });
    if (!ok) return;
    setError(null);
    setPhase({ name: "applying", dryRun, progress: null });
    try {
      const result = await timeMigrationApi.applyReResolve(dryRun.dryRunId, (job) => {
        if (job.progress) setPhase({ name: "applying", dryRun, progress: job.progress });
      });
      setPhase({ name: "applied", result });
    } catch (err: unknown) {
      logger.error({ err }, "ZoneReResolve: apply failed");
      setError(timeModelErrorCopy(err, t, "admin:timeModel.reResolve.errors.applyFailed"));
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
          {error}
        </p>
      )}

      {phase.name === "dryRunning" && (
        <p className="t-caption">{t("admin:timeModel.reResolve.dryRunningHint")}</p>
      )}

      {(phase.name === "reviewed" || phase.name === "applying") && (
        <DryRunResult
          dryRun={phase.dryRun}
          applying={phase.name === "applying"}
          progress={phase.name === "applying" ? phase.progress : null}
          onApply={() => void apply(phase.dryRun)}
        />
      )}

      {phase.name === "applied" && (
        <p role="status">
          {t("admin:timeModel.reResolve.applied", {
            applied: phase.result.applied,
            skipped: phase.result.skipped,
          })}
        </p>
      )}
      {confirmDialog}
    </div>
  );
}

function DryRunResult({
  dryRun,
  applying,
  progress,
  onApply,
}: {
  dryRun: ZoneReResolveDryRun;
  applying: boolean;
  progress: { done: number; total: number } | null;
  onApply: () => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);

  return (
    <div className="flex flex-col gap-3">
      <p>
        {t("admin:timeModel.reResolve.summary", {
          scanned: dryRun.scanned,
          changes: dryRun.changesTotal,
        })}
      </p>
      {dryRun.unresolvable > 0 && (
        <p className="t-caption">
          {t("admin:timeModel.reResolve.unresolvable", { count: dryRun.unresolvable })}
        </p>
      )}

      {dryRun.changesTotal === 0 ? (
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
                    key={`${c.table}|${c.entityId}|${c.field}`}
                    style={{ borderTop: "1px solid var(--ts-border)" }}
                  >
                    <td className="py-1 pr-3">
                      <div>{c.label || t("admin:timeModel.report.unresolved.unnamed")}</div>
                      <div className="t-caption">
                        {tableLabel(t, c.table)} · {fieldLabel(t, c.field)}
                      </div>
                    </td>
                    <td className="py-1 pr-3" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {c.fromZone}
                    </td>
                    <td className="py-1 pr-3" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {c.toZone}
                    </td>
                    <td className="py-1 text-right" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {formatOffsetDelta(c.offsetDeltaMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dryRun.changesTotal > dryRun.changes.length && (
            <p className="t-caption">
              {t("admin:timeModel.reResolve.more", {
                shown: dryRun.changes.length,
                total: dryRun.changesTotal,
              })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onApply} disabled={applying}>
              {applying
                ? t("admin:timeModel.reResolve.applying")
                : t("admin:timeModel.reResolve.apply")}
            </Button>
            {applying && (
              <span className="t-caption" role="status">
                {progress
                  ? t("admin:timeModel.reResolve.progress", progress)
                  : t("admin:timeModel.reResolve.progressUnknown")}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
