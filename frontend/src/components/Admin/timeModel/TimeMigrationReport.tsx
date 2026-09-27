import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import { timeMigrationApi } from "../../../lib/api/timeMigration";
import { useAuthStore } from "../../../store/authStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type {
  TimeMigrationCount,
  TimeMigrationOutcome,
  TimeMigrationReport as Report,
  TimeMigrationUnresolvedRow,
} from "../../../types/timeMigrationDraft";
import Button from "../../ui/Button";
import StatTile from "../../ui/StatTile";
import { isTimeFlagEntityType, timeValueEditorPath } from "../../DataQuality/timeFlagLinks";
import {
  fieldLabel,
  reasonLabel,
  ruleLabel,
  tableLabel,
  timeModelErrorCopy,
} from "./timeModelCopy";

/**
 * What the time-model backfill did on this instance (ADR 0002, plan Phase 3b)
 * — the report the owner reads and signs off before a promotion.
 *
 * It has to say three things and never blur them: what was CONVERTED (a value
 * written into the new columns), what was KEPT (already meant what it said),
 * and what was LEFT (nothing written, flagged to its owner). And it has to
 * say when it does not know: a report that failed to load is a sentence and a
 * retry, never a row of zeros — "0 unresolved" over a failed request is the
 * exact lie this screen exists to prevent.
 */

const OUTCOMES: TimeMigrationOutcome[] = ["converted", "kept", "unresolved"];

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
  borderRadius: "var(--ts-radius-card)",
} as const;

// The failure is kept as the error, not as a sentence: the words are chosen
// at render time, in the reader's current language.
type Load =
  { state: "loading" } | { state: "failed"; error: unknown } | { state: "ok"; report: Report };

function totalsOf(counts: TimeMigrationCount[]): Record<TimeMigrationOutcome, number> {
  return counts.reduce((acc, c) => ({ ...acc, [c.outcome]: acc[c.outcome] + c.count }), {
    converted: 0,
    kept: 0,
    unresolved: 0,
  } as Record<TimeMigrationOutcome, number>);
}

export default function TimeMigrationReport(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchReport = useCallback(async (): Promise<void> => {
    setLoad({ state: "loading" });
    try {
      setLoad({ state: "ok", report: await timeMigrationApi.getReport() });
    } catch (err: unknown) {
      logger.error({ err }, "TimeMigrationReport: load failed");
      setLoad({ state: "failed", error: err });
    }
  }, []);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  return (
    <div className="flex flex-col gap-4 p-6" style={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {t("admin:timeModel.report.title")}
          </h3>
          <p className="t-caption mt-1">{t("admin:timeModel.report.description")}</p>
        </div>
        <Button onClick={() => void fetchReport()} disabled={load.state === "loading"}>
          {t("admin:timeModel.report.reload")}
        </Button>
      </div>

      {load.state === "loading" && (
        <p className="t-caption">{t("admin:timeModel.report.loading")}</p>
      )}

      {load.state === "failed" && (
        <div role="alert" className="flex flex-col gap-1">
          <p style={{ color: "var(--ts-bad)", fontWeight: 600 }}>
            {timeModelErrorCopy(load.error, t, "admin:timeModel.report.errors.loadFailed")}
          </p>
          <p className="t-caption">{t("admin:timeModel.report.errors.notAVerdict")}</p>
        </div>
      )}

      {load.state === "ok" && <ReportBody report={load.report} />}
    </div>
  );
}

function ReportBody({ report }: { report: Report }): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const format = useDisplayFormat();
  const profileZone = useSettingsStore((s) => s.display?.timezone) || undefined;
  const totals = useMemo(() => totalsOf(report.counts), [report.counts]);

  if (report.status === "not_run") {
    return <p>{t("admin:timeModel.report.status.not_run")}</p>;
  }
  if (report.status === "running") {
    return <p>{t("admin:timeModel.report.status.running")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {report.status === "failed" ? (
        <p role="alert" style={{ color: "var(--ts-bad)", fontWeight: 600 }}>
          {t("admin:timeModel.report.status.failed")}
        </p>
      ) : (
        <p>
          {t("admin:timeModel.report.status.done", {
            when: report.ranAt ? format.dateTime(report.ranAt, { timeZone: profileZone }) : "—",
          })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {OUTCOMES.map((outcome) => (
          <StatTile
            key={outcome}
            value={totals[outcome]}
            label={t(`admin:timeModel.report.outcomes.${outcome}`)}
          />
        ))}
      </div>

      {/* The statement the owner signs off on, in words rather than numbers. */}
      <ul className="t-caption flex list-disc flex-col gap-1 pl-5">
        <li>{t("admin:timeModel.report.statement.converted", { count: totals.converted })}</li>
        <li>{t("admin:timeModel.report.statement.kept", { count: totals.kept })}</li>
        <li>{t("admin:timeModel.report.statement.unresolved", { count: totals.unresolved })}</li>
        <li>{t("admin:timeModel.report.statement.legacyUntouched")}</li>
      </ul>

      {report.counts.length > 0 && <CountTable counts={report.counts} />}

      <UnresolvedList rows={report.unresolved} total={report.unresolvedTotal} />
    </div>
  );
}

function CountTable({ counts }: { counts: TimeMigrationCount[] }): JSX.Element {
  const { t } = useTranslation(["admin"]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="t-label-mono mb-2 text-left">
          {t("admin:timeModel.report.table.caption")}
        </caption>
        <thead>
          <tr style={{ color: "var(--ts-muted)" }}>
            <th className="py-1 pr-3 text-left">{t("admin:timeModel.report.table.table")}</th>
            <th className="py-1 pr-3 text-left">{t("admin:timeModel.report.table.rule")}</th>
            <th className="py-1 pr-3 text-left">{t("admin:timeModel.report.table.reason")}</th>
            <th className="py-1 pr-3 text-left">{t("admin:timeModel.report.table.outcome")}</th>
            <th className="py-1 text-right">{t("admin:timeModel.report.table.count")}</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((c) => (
            <tr
              key={`${c.table}|${c.rule}|${c.reason ?? ""}|${c.outcome}`}
              style={{ borderTop: "1px solid var(--ts-border)" }}
            >
              <td className="py-1 pr-3">{tableLabel(t, c.table)}</td>
              <td className="py-1 pr-3">{ruleLabel(t, c.rule)}</td>
              <td className="py-1 pr-3">{c.reason ? reasonLabel(t, c.reason) : "—"}</td>
              <td className="py-1 pr-3">{t(`admin:timeModel.report.outcomes.${c.outcome}`)}</td>
              <td className="py-1 text-right" style={{ fontFamily: "var(--ts-font-mono)" }}>
                {c.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnresolvedList({
  rows,
  total,
}: {
  rows: TimeMigrationUnresolvedRow[];
  total: number;
}): JSX.Element | null {
  const { t } = useTranslation(["admin"]);
  const viewerId = useAuthStore((s) => s.user?.id);
  if (total === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="t-label-mono">{t("admin:timeModel.report.unresolved.title", { total })}</h4>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={`${row.table}|${row.entityId}|${row.field}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
            style={{ borderTop: "1px solid var(--ts-border)" }}
          >
            <span style={{ fontWeight: 600 }}>
              {row.label || t("admin:timeModel.report.unresolved.unnamed")}
            </span>
            <span className="t-caption">
              {tableLabel(t, row.table)} · {fieldLabel(t, row.field)} · {reasonLabel(t, row.reason)}
            </span>
            <span className="ml-auto text-sm">
              <FixLink row={row} viewerId={viewerId} />
            </span>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <p className="t-caption">
          {t("admin:timeModel.report.unresolved.more", { shown: rows.length, total })}
        </p>
      )}
    </section>
  );
}

/**
 * Where the row gets fixed. The admin can open the editor for their own rows
 * only; another user's row is fixed by that user, from their inbox, and the
 * line says whose inbox. A row with no editor to reach says that too.
 */
function FixLink({
  row,
  viewerId,
}: {
  row: TimeMigrationUnresolvedRow;
  viewerId: string | undefined;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  if (row.ownerId !== viewerId) {
    return (
      <span className="t-caption">
        {t("admin:timeModel.report.unresolved.otherInbox", { user: row.ownerUsername })}
      </span>
    );
  }
  const path =
    row.flagKind && isTimeFlagEntityType(row.table)
      ? timeValueEditorPath(row.table, row.entityId, row.parentId, row.flagKind)
      : null;
  if (!path) {
    return <span className="t-caption">{t("admin:timeModel.report.unresolved.noEditor")}</span>;
  }
  return (
    <Link to={path} className="underline" style={{ color: "var(--ts-accent)" }}>
      {t("admin:timeModel.report.unresolved.fix")}
    </Link>
  );
}
