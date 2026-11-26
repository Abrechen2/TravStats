import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { formatDate } from "../../lib/displayFormat";
import { JobLostError, jobErrorCode, waitForJob } from "../../lib/api/jobs";
import { errorText, scanFailureReason } from "../MailIntake/mailIntakeCopy";
import {
  mailIntakeApi,
  mailIntakeErrorCode,
  type MailCandidate,
  type MailCandidateList,
  type MailImportResult,
} from "../../lib/api/mailIntake";
import { Card } from "../ui/Card";
import InlineError from "../ui/InlineError";

type Range = "all" | "custom";

/** The day after `day` (YYYY-MM-DD): IMAP SEARCH BEFORE is exclusive, the form's "to" is not. */
function dayAfter(day: string): string {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * "Postfach durchsuchen" (inbox): a one-off, header-only search of the user's
 * own mail folder for booking mails probably missing in TravStats. The list
 * holds header fields only; "Importieren" is the one moment a mail is
 * downloaded. Renders nothing when the account has no mail folder.
 */
export default function MailboxScanSection(): JSX.Element | null {
  const { t } = useTranslation(["mailIntake", "common"]);
  const [hasFolder, setHasFolder] = useState(false);
  const [list, setList] = useState<MailCandidateList | null>(null);
  const [range, setRange] = useState<Range>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const status = await mailIntakeApi.status();
      const folder = !!status.source && status.off === null;
      setHasFolder(folder);
      if (folder) setList(await mailIntakeApi.candidates());
    } catch (error) {
      // An older server has no such route; the inbox must not complain about it.
      logger.warn("Failed to load the mailbox scan:", error);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const failText = (error: unknown): string => {
    const code =
      error instanceof JobLostError ? "lost" : (jobErrorCode(error) ?? mailIntakeErrorCode(error));
    const reason = scanFailureReason(t, code);
    return t("mailIntake:scan.error", { reason });
  };

  const runJob = async <T,>(start: () => Promise<string>, done: (r: T) => string | null) => {
    setBusy(true);
    setNotice(null);
    setProgress(null);
    try {
      const jobId = await start();
      const result = await waitForJob<T>(jobId, {
        onPoll: (job) => {
          if (job.progress) setProgress(job.progress);
          void mailIntakeApi
            .candidates()
            .then(setList)
            .catch((error: unknown) => logger.warn("Failed to refresh the scan list", error));
        },
      });
      const text = done(result);
      if (text) setNotice({ ok: true, text });
    } catch (error) {
      logger.error("Mailbox scan action failed", error);
      console.warn("[mailbox scan] action failed", error);
      setNotice({ ok: false, text: failText(error) });
    } finally {
      setBusy(false);
      setProgress(null);
      setSelected(new Set());
      await load();
    }
  };

  const startScan = (resume: boolean): Promise<void> =>
    runJob(
      () =>
        mailIntakeApi.startScan(
          resume
            ? { resume: true }
            : range === "custom"
              ? {
                  ...(since ? { since } : {}),
                  ...(until ? { before: dayAfter(until) } : {}),
                }
              : {}
        ),
      () => null
    );

  const importIds = (ids: string[]): Promise<void> =>
    runJob<MailImportResult>(
      () => mailIntakeApi.importCandidates(ids),
      (r) =>
        t("mailIntake:scan.importResult", {
          imported: r.imported,
          proposed: r.proposed,
          failed: r.failed,
        })
    );

  const ignoreIds = async (ids: string[]): Promise<void> => {
    setNotice(null);
    try {
      await mailIntakeApi.ignoreCandidates(ids);
      setSelected(new Set());
    } catch (error) {
      logger.error("Ignoring scan candidates failed", error);
      console.warn("[mailbox scan] ignore failed", error);
      setNotice({ ok: false, text: failText(error) });
    }
    await load();
  };

  const cancel = async (): Promise<void> => {
    try {
      await mailIntakeApi.cancelScan();
    } catch (error) {
      logger.error("Cancelling the mailbox scan failed", error);
      setNotice({ ok: false, text: failText(error) });
    }
  };

  if (!hasFolder || !list) return null;
  const { scan, items, ignoredCount } = list;
  const missing = items.filter((i) => i.matchHint === null);
  const likely = items.filter((i) => i.matchHint !== null);
  const canResume = scan && (scan.status === "cancelled" || scan.status === "interrupted");
  const running = busy && !!progress && scan?.status === "running";
  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (item: MailCandidate): JSX.Element => (
    <li
      key={item.id}
      data-testid="mail-scan-candidate"
      className="flex flex-wrap items-center justify-between"
      style={{
        gap: "var(--ts-space-md)",
        borderTop: "1px solid var(--ts-border)",
        paddingTop: "var(--ts-space-md)",
      }}
    >
      <label className="flex items-start gap-2" style={{ color: "var(--ts-text)" }}>
        <input
          type="checkbox"
          checked={selected.has(item.id)}
          disabled={busy}
          onChange={() => toggle(item.id)}
        />
        <span className="flex flex-col">
          <span>
            <strong>{item.brand ?? item.from ?? ""}</strong>
            {" · "}
            {item.subject || t("mailIntake:inbox.noSubject")}
          </span>
          <span className="t-caption">
            {item.receivedAt ? formatDate(item.receivedAt) : ""}
            {item.guessedDomain
              ? ` · ${t(`mailIntake:domains.${item.guessedDomain}`, { defaultValue: item.guessedDomain })}`
              : ""}
            {item.from && item.brand ? ` · ${item.from}` : ""}
          </span>
          {item.matchHint && <span className="t-caption">{t("mailIntake:scan.likelyHint")}</span>}
          {item.status === "failed" && item.reason && (
            <InlineError>
              {t(`mailIntake:scan.reason.${item.reason}`, { defaultValue: item.reason })}
            </InlineError>
          )}
        </span>
      </label>
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void importIds([item.id])}
        >
          {t("mailIntake:scan.import")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void ignoreIds([item.id])}
        >
          {t("mailIntake:scan.ignore")}
        </button>
      </span>
    </li>
  );

  const ids = [...selected];
  return (
    <Card style={{ marginBottom: "var(--ts-space-xl)" }} aria-labelledby="mail-scan-title">
      <h3
        id="mail-scan-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("mailIntake:scan.title")}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t("mailIntake:scan.description")}
      </p>

      <div className="flex flex-wrap items-end gap-3" style={{ marginTop: "var(--ts-space-md)" }}>
        <label>
          <span className="label">{t("mailIntake:scan.range")}</span>
          <select
            className="input"
            value={range}
            disabled={busy}
            onChange={(e) => setRange(e.target.value as Range)}
          >
            <option value="all">{t("mailIntake:scan.rangeAll")}</option>
            <option value="custom">{t("mailIntake:scan.rangeCustom")}</option>
          </select>
        </label>
        {range === "custom" && (
          <>
            <label>
              <span className="label">{t("mailIntake:scan.since")}</span>
              <input
                className="input"
                type="date"
                value={since}
                disabled={busy}
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
            <label>
              <span className="label">{t("mailIntake:scan.before")}</span>
              <input
                className="input"
                type="date"
                value={until}
                disabled={busy}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void startScan(false)}
        >
          {t("mailIntake:scan.start")}
        </button>
        {canResume && !busy && (
          <button type="button" className="btn-secondary" onClick={() => void startScan(true)}>
            {t("mailIntake:scan.resume")}
          </button>
        )}
        {running && (
          <button type="button" className="btn-secondary" onClick={() => void cancel()}>
            {t("mailIntake:scan.cancel")}
          </button>
        )}
      </div>

      {(progress || scan) && (
        <p className="t-caption" role="status" style={{ marginTop: "var(--ts-space-md)" }}>
          {progress
            ? t("mailIntake:scan.progress", { scanned: progress.done, total: progress.total })
            : scan
              ? `${t(`mailIntake:scan.status.${scan.status}`)} ${t("mailIntake:scan.summary", {
                  scanned: scan.scanned,
                  candidates: scan.candidates,
                  matched: scan.matched,
                  skipped: scan.skipped,
                })}`
              : ""}
          {ignoredCount > 0
            ? ` · ${t("mailIntake:scan.ignoredCount", { count: ignoredCount })}`
            : ""}
        </p>
      )}
      {!busy && scan?.status === "failed" && (
        <p role="alert" style={{ marginTop: "var(--ts-space-md)", color: "var(--ts-bad)" }}>
          {t("mailIntake:scan.error", {
            reason: errorText(t, scan.error, "mailIntake:scan.errors.unknown"),
          })}
        </p>
      )}
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          style={{
            marginTop: "var(--ts-space-md)",
            ...(notice.ok ? {} : { color: "var(--ts-bad)" }),
          }}
        >
          {notice.text}
        </p>
      )}

      {scan && items.length === 0 && scan.status === "done" && (
        <p className="t-caption" style={{ marginTop: "var(--ts-space-md)" }}>
          {t("mailIntake:scan.empty")}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--ts-space-md)" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setSelected(new Set(missing.map((i) => i.id)))}
          >
            {t("mailIntake:scan.selectAll")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || ids.length === 0}
            onClick={() => void importIds(ids)}
          >
            {t("mailIntake:scan.importSelected", { count: ids.length })}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || ids.length === 0}
            onClick={() => void ignoreIds(ids)}
          >
            {t("mailIntake:scan.ignoreSelected", { count: ids.length })}
          </button>
        </div>
      )}
      {missing.length > 0 && (
        <section style={{ marginTop: "var(--ts-space-lg)" }}>
          <h4 className="t-label-mono">
            {t("mailIntake:scan.missingTitle", { count: missing.length })}
          </h4>
          <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            {missing.map(row)}
          </ul>
        </section>
      )}
      {likely.length > 0 && (
        <details style={{ marginTop: "var(--ts-space-lg)" }}>
          <summary className="t-label-mono">
            {t("mailIntake:scan.likelyTitle", { count: likely.length })}
          </summary>
          <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            {likely.map(row)}
          </ul>
        </details>
      )}
    </Card>
  );
}
