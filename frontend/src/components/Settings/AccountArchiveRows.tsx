import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { accountArchiveApi, type AccountArchiveStatus } from "../../lib/api/accountArchive";
import { jobErrorCode, JobLostError, type JobView as ApiJob } from "../../lib/api/jobs";
import { downloadBlob } from "../../lib/export";
import { logger } from "../../lib/logger";
import { Icon } from "../ui/Icon";
import { ConfirmDialog, Dependency, ErrorLine, JobStatus, SettingItem } from "../ui/settings";
import type { JobView } from "../ui/settings";
import { useRowCopy } from "./rowCopy";

/** Codes the page has its own sentence for; anything else reads as `generic`. */
const KNOWN_CODES = new Set([
  "ACCOUNT_ARCHIVE_TOO_LARGE",
  "ACCOUNT_ARCHIVE_BUSY",
  "ACCOUNT_ARCHIVE_NOT_FOUND",
  "ACCOUNT_ARCHIVE_INVALID",
  "ACCOUNT_ARCHIVE_CHECKSUM",
  "ACCOUNT_ARCHIVE_FORMAT_TOO_NEW",
  "ACCOUNT_ARCHIVE_SCHEMA_TOO_NEW",
  "ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY",
  "ACCOUNT_ARCHIVE_ALREADY_IMPORTED",
  "rate_limited",
]);

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done?: number; total?: number }
  | { kind: "done"; text: string }
  | { kind: "failed"; reason: string }
  | { kind: "unknown" };

function useFailure(): (err: unknown) => Phase {
  const { t } = useTranslation(["settings"]);
  return (err) => {
    if (err instanceof JobLostError) return { kind: "unknown" };
    const code = jobErrorCode(err);
    const key = code && KNOWN_CODES.has(code) ? code : "generic";
    // Visible on the page AND in the console (owner, 2026-11-18).
    logger.warn("Account archive failed:", code ?? err);
    return { kind: "failed", reason: t(`settings:accountArchive.failed.${key}`) };
  };
}

const progressOf = (job: ApiJob<unknown>): Phase =>
  job.progress
    ? { kind: "running", done: job.progress.done, total: job.progress.total }
    : { kind: "running" };

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const sumRows = (tables: Record<string, number>): number =>
  Object.values(tables).reduce((a, b) => a + b, 0);

function jobView(phase: Phase, what: string, retry: () => void, check: () => void): JobView | null {
  switch (phase.kind) {
    case "running":
      return { kind: "running", what, done: phase.done, total: phase.total };
    case "done":
      return { kind: "done", result: phase.text };
    case "failed":
      return { kind: "failed", reason: phase.reason, onRetry: retry };
    case "unknown":
      return { kind: "unknown", onCheck: check };
    default:
      return null;
  }
}

/** What moves with the archive and what stays behind: shown on both rows. */
function MovesNote(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <div className="t-caption flex flex-col" style={{ gap: "var(--ts-space-xs)", margin: 0 }}>
      <p style={{ margin: 0 }}>{t("settings:accountArchive.moves")}</p>
      <p style={{ margin: 0 }} data-archive-stays="">
        {t("settings:accountArchive.stays")}
      </p>
    </div>
  );
}

function ExportRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const copy = useRowCopy("data")("archiv");
  const failure = useFailure();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const run = useCallback(async () => {
    setPhase({ kind: "running" });
    try {
      const result = await accountArchiveApi.exportArchive((job) => setPhase(progressOf(job)));
      const blob = await accountArchiveApi.download(result.exportId);
      downloadBlob(blob, result.filename);
      const missing =
        result.missingFiles > 0
          ? ` ${t("settings:accountArchive.missingFiles", { count: result.missingFiles })}`
          : "";
      const omitted = (result.omittedFiles ?? [])
        .map(
          (o) => `${o.dir}/${o.name} (${t(`settings:accountArchive.omittedReason.${o.reason}`)})`
        )
        .join("; ");
      if (missing) logger.warn("Account archive written without some files:", result.missingFiles);
      setPhase({
        kind: "done",
        text:
          t("settings:accountArchive.exported", {
            size: formatBytes(result.bytes),
            rows: sumRows(result.tables),
            files: result.files,
          }) +
          missing +
          (omitted ? ` ${omitted}` : ""),
      });
    } catch (err) {
      setPhase(failure(err));
    }
  }, [t, failure]);

  const view = jobView(
    phase,
    t("settings:accountArchive.exporting"),
    () => void run(),
    () => void run()
  );
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      job={view ? <JobStatus job={view} /> : undefined}
      control={
        <button
          type="button"
          onClick={() => void run()}
          disabled={phase.kind === "running"}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Icon name="download" size={14} />
          {copy.btn ?? t("settings:accountArchive.exportButton")}
        </button>
      }
    >
      <MovesNote />
    </SettingItem>
  );
}

/** A ZIP by name or type — the only thing an account archive can be. */
export function isZipFile(file: Pick<File, "name" | "type">): boolean {
  return /\.zip$/i.test(file.name) || /^application\/(x-)?zip/.test(file.type);
}

function ImportRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const copy = useRowCopy("data")("archivein");
  const failure = useFailure();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<AccountArchiveStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const load = useCallback(async () => {
    try {
      setStatus(await accountArchiveApi.status());
      setStatusFailed(false);
    } catch (err) {
      logger.warn("Could not read whether the account can take an archive:", err);
      setStatusFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (chosen: File) => {
      setFile(null);
      setPhase({ kind: "running" });
      try {
        const result = await accountArchiveApi.importArchive(chosen, (job) =>
          setPhase(progressOf(job))
        );
        const imported = result.alreadyImported
          ? t("settings:accountArchive.alreadyImported")
          : t("settings:accountArchive.imported", {
              rows: sumRows(result.tables),
              files: result.files,
            });
        const skipped = sumRows(result.skipped ?? {});
        const partial =
          skipped + (result.unmatched ?? 0) + (result.refusedFiles ?? 0) > 0
            ? ` ${t("settings:accountArchive.partial", {
                skipped,
                unmatched: result.unmatched ?? 0,
                refused: result.refusedFiles ?? 0,
              })}`
            : "";
        if (partial) logger.warn("Account archive imported with gaps:", result);
        setPhase({ kind: "done", text: imported + partial });
      } catch (err) {
        setPhase(failure(err));
      } finally {
        void load();
      }
    },
    [t, failure, load]
  );

  const tooLarge = file && status ? file.size > status.maxBytes : false;
  // `accept` is a hint a drop or a file manager can step over: a .gpx reached the "restore this
  // archive?" question (UAT rc.45 retest, D25). Only a ZIP is ever offered for restore.
  const notArchive = file !== null && !isZipFile(file);
  const blocked = status !== null && !status.empty && phase.kind !== "done";
  const view = jobView(
    phase,
    t("settings:accountArchive.importing"),
    () => input.current?.click(),
    () => void load()
  );
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      error={statusFailed ? t("settings:accountArchive.statusFailed") : undefined}
      job={view ? <JobStatus job={view} /> : undefined}
      control={
        <>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            data-testid="account-archive-file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={phase.kind === "running" || blocked || status === null}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Icon name="upload" size={14} />
            {copy.btn ?? t("settings:accountArchive.importButton")}
          </button>
        </>
      }
    >
      {blocked ? <Dependency reason={t("settings:accountArchive.notEmpty")} /> : null}
      {tooLarge ? (
        <ErrorLine>{t("settings:accountArchive.failed.ACCOUNT_ARCHIVE_TOO_LARGE")}</ErrorLine>
      ) : null}
      {notArchive ? (
        <ErrorLine>{t("settings:accountArchive.notArchive", { name: file?.name ?? "" })}</ErrorLine>
      ) : null}
      <MovesNote />
      <ConfirmDialog
        open={file !== null && !tooLarge && !notArchive}
        title={t("settings:accountArchive.confirm.title")}
        affects={t("settings:accountArchive.confirm.affects")}
        amount={file ? `${file.name} · ${formatBytes(file.size)}` : ""}
        after={t("settings:accountArchive.confirm.after")}
        confirmLabel={t("settings:accountArchive.confirm.button")}
        onConfirm={() => file && void run(file)}
        onCancel={() => setFile(null)}
      />
    </SettingItem>
  );
}

/**
 * "Konto umziehen" (forgejo#433): the account as a ZIP with every record and file,
 * and the import of such a ZIP into an empty account on this server.
 */
export default function AccountArchiveRows(): JSX.Element {
  return (
    <>
      <ExportRow />
      <ImportRow />
    </>
  );
}
