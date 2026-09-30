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
  TimeMigrationOpenRow,
  TimeMigrationReport as Report,
} from "../../../types/timeMigration";
import { timeValueEditorPath } from "../../DataQuality/timeFlagLinks";
import Button from "../../ui/Button";
import StatTile from "../../ui/StatTile";
import {
  backfillErrorLabel,
  columnLabel,
  reasonLabel,
  tableLabel,
  timeModelErrorCopy,
  unchangedLabel,
} from "./timeModelCopy";
import { TimeMigrationTables } from "./TimeMigrationTables";

/**
 * What the time-model backfill did on this instance (ADR 0002, plan Phase 3b)
 * — the report the owner reads and signs off before a promotion.
 *
 * It has to say three things and never blur them: which rows were CONVERTED,
 * which already held the new values and were LEFT AS THEY WERE, and which are
 * OPEN (nothing guessed, a question in the owner's inbox) — plus what the
 * backfill deliberately never touches. And it has to say when it does not
 * know: a report that failed to load, or has not run yet, is a sentence,
 * never a row of zeros — "0 open" over a failed request is the exact lie this
 * screen exists to prevent.
 */

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
  borderRadius: "var(--ts-radius-card)",
} as const;

/** The inbox, where the owner of an open row answers its question. */
const INBOX_PATH = "/pending-updates";

// The failure is kept as the error, not as a sentence: the words are chosen
// at render time, in the reader's current language.
type Load =
  { state: "loading" } | { state: "failed"; error: unknown } | { state: "ok"; report: Report };

export interface ReportUser {
  id: string;
  username: string;
}

export default function TimeMigrationReport({
  users = [],
}: {
  /** The instance's accounts, to name the owner of an open row. */
  users?: ReportUser[];
}): JSX.Element {
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

      {load.state === "ok" && <ReportBody report={load.report} users={users} />}
    </div>
  );
}

function ReportBody({ report, users }: { report: Report; users: ReportUser[] }): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const format = useDisplayFormat();
  const profileZone = useSettingsStore((s) => s.display?.timezone) || undefined;
  const totals = useMemo(
    () =>
      report.tables.reduce(
        (acc, row) => ({
          converted: acc.converted + row.converted,
          alreadyFilled: acc.alreadyFilled + row.alreadyFilled,
          answered: acc.answered + row.answered,
          open: acc.open + row.open,
        }),
        { converted: 0, alreadyFilled: 0, answered: 0, open: 0 }
      ),
    [report.tables]
  );
  const { backfill } = report;

  // Before a run there is nothing to count, and during one the numbers are a
  // moving target — either way a sentence, not a table of zeros.
  if (backfill.state === "pending") return <p>{t("admin:timeModel.report.status.pending")}</p>;
  if (backfill.state === "running") return <p>{t("admin:timeModel.report.status.running")}</p>;

  return (
    <div className="flex flex-col gap-5">
      {backfill.state === "failed" ? (
        <p role="alert" style={{ color: "var(--ts-bad)", fontWeight: 600 }}>
          {t("admin:timeModel.report.status.failed", {
            error: backfill.lastError
              ? backfillErrorLabel(t, backfill.lastError)
              : t("admin:timeModel.report.status.noErrorCode"),
          })}
        </p>
      ) : (
        <p>
          {t("admin:timeModel.report.status.completed", {
            when: backfill.completedAt
              ? format.dateTime(backfill.completedAt, { timeZone: profileZone })
              : "—",
            tzdata: backfill.tzdata ?? "—",
          })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={totals.converted} label={t("admin:timeModel.report.outcomes.converted")} />
        <StatTile
          value={totals.alreadyFilled}
          label={t("admin:timeModel.report.outcomes.alreadyFilled")}
        />
        <StatTile value={totals.answered} label={t("admin:timeModel.report.outcomes.answered")} />
        <StatTile value={totals.open} label={t("admin:timeModel.report.outcomes.open")} />
      </div>

      {/* The statement the owner signs off on, in words rather than numbers. */}
      <ul className="t-caption flex list-disc flex-col gap-1 pl-5">
        <li>{t("admin:timeModel.report.statement.converted", { count: totals.converted })}</li>
        <li>
          {t("admin:timeModel.report.statement.alreadyFilled", { count: totals.alreadyFilled })}
        </li>
        <li>{t("admin:timeModel.report.statement.answered", { count: totals.answered })}</li>
        <li>{t("admin:timeModel.report.statement.open", { count: totals.open })}</li>
        <li>
          {t("admin:timeModel.report.statement.flags", {
            open: report.flags.open,
            resolved: report.flags.resolved,
            dismissed: report.flags.dismissed,
          })}
        </li>
        <li>{t("admin:timeModel.report.statement.legacyUntouched")}</li>
        {report.unchanged.length > 0 && (
          <li>
            {t("admin:timeModel.report.unchanged.title")}{" "}
            {report.unchanged.map((u) => unchangedLabel(t, u.domain, u.why)).join(" · ")}
          </li>
        )}
      </ul>

      <TimeMigrationTables tables={report.tables} />

      <OpenRows rows={report.openRows} truncated={report.openRowsTruncated} users={users} />
    </div>
  );
}

function OpenRows({
  rows,
  truncated,
  users,
}: {
  rows: TimeMigrationOpenRow[];
  truncated: boolean;
  users: ReportUser[];
}): JSX.Element | null {
  const { t } = useTranslation(["admin"]);
  const viewerId = useAuthStore((s) => s.user?.id);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="t-label-mono">
        {t("admin:timeModel.report.openRows.title", { count: rows.length })}
      </h4>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={`${row.table}|${row.rowId}|${row.column}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
            style={{ borderTop: "1px solid var(--ts-border)" }}
          >
            <span style={{ fontWeight: 600 }}>{tableLabel(t, row.table)}</span>
            {row.label && <span>{row.label}</span>}
            <span className="t-caption">
              {columnLabel(t, row.column)} ·{" "}
              {row.reason ? reasonLabel(t, row.reason) : t("admin:timeModel.report.noReason")}
            </span>
            {row.legacyValue && (
              <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                {row.legacyValue}
              </span>
            )}
            <span className="ml-auto text-sm">
              <Owner row={row} viewerId={viewerId} users={users} />
            </span>
          </li>
        ))}
      </ul>
      {truncated && <p className="t-caption">{t("admin:timeModel.report.openRows.truncated")}</p>}
    </section>
  );
}

/**
 * Who answers the row. The admin's own row opens straight in the editor that
 * fills it (the same one its inbox question opens); a row whose editor cannot
 * be named still reaches the inbox. Another account's row is that user's to
 * answer — its records are not the admin's to open — and the line says whose.
 */
function Owner({
  row,
  viewerId,
  users,
}: {
  row: TimeMigrationOpenRow;
  viewerId: string | undefined;
  users: ReportUser[];
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  if (row.userId !== null && row.userId === viewerId) {
    const editor = timeValueEditorPath(
      {
        entityType: row.entityType,
        entityId: row.rowId,
        parentType: row.parentType,
        parentId: row.parentId,
        tripId: row.tripId,
      },
      // Without a known question the row's own editor, not its place's.
      row.kind ?? "time_precision_unknown"
    );
    return (
      <span className="flex flex-wrap gap-x-3">
        {editor && (
          <Link to={editor} className="underline" style={{ color: "var(--ts-accent)" }}>
            {t("admin:timeModel.report.openRows.openEditor")}
          </Link>
        )}
        {(row.flagId || !editor) && (
          <Link to={INBOX_PATH} className="underline" style={{ color: "var(--ts-accent)" }}>
            {t("admin:timeModel.report.openRows.answer")}
          </Link>
        )}
      </span>
    );
  }
  const username = users.find((u) => u.id === row.userId)?.username;
  return (
    <span className="t-caption">
      {username
        ? t("admin:timeModel.report.openRows.otherInbox", { user: username })
        : t("admin:timeModel.report.openRows.unknownOwner")}
    </span>
  );
}
