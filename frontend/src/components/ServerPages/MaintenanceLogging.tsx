import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import { formatBytes } from "../../lib/fileSize";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import {
  LOG_LEVELS,
  type LogFileInfo,
  type LoggingConfigResponse,
  type LogLevelName,
} from "../../shared/logContract";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import LogViewer from "../Admin/LogViewer";
import { logErrorCopy } from "../Admin/logErrorCopy";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import {
  ActionControl,
  ChoiceControl,
  ConfirmDialog,
  ErrorLine,
  InputControl,
  SettingItem,
  SwitchControl,
  useGroupSave,
} from "../ui/settings";
import GroupFooter from "./GroupFooter";
import MaintenanceDebug24 from "./MaintenanceDebug24";

interface Draft extends Record<string, unknown> {
  level: LogLevelName;
  retentionDays: string;
  http: boolean;
  database: boolean;
  parser: boolean;
}

const draftOf = (c: LoggingConfigResponse): Draft => ({
  level: c.logLevel,
  retentionDays: String(c.logRetentionDays),
  http: c.logHttpRequests,
  database: c.logDatabaseQueries,
  parser: c.logParserOperations,
});

/** Files older than the retention are what "Alte Protokolle löschen" sweeps. */
function sweepable(files: readonly LogFileInfo[], days: number): { count: number; bytes: number } {
  // The sweep is the server's; this only sizes the question so the button names the amount.
  const cutoff = Date.now() - days * 86_400_000;
  const old = files.filter((f) => new Date(f.modified).getTime() < cutoff);
  return { count: old.length, bytes: old.reduce((sum, f) => sum + f.size, 0) };
}

/**
 * Maintenance › Protokoll (design C7, Expert): the level and retention as one
 * group, the verbose switch as an immediate row, the files with viewer, and the
 * cleanup behind the confirmation block. A level pinned by the environment is
 * said, and the rows that cannot act on it are locked, not hidden.
 */
export default function MaintenanceLogging(): JSX.Element {
  const { t, i18n } = useTranslation(["settingsRows", "admin"]);
  const [config, setConfig] = useState<LoggingConfigResponse | null>(null);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [c, f] = await Promise.all([adminApi.getLoggingConfig(), adminApi.getLogFiles()]);
      setConfig(c);
      setFiles(f.files);
      setFailed(false);
    } catch (error) {
      logger.error("Failed to load logging data:", error);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (config) return <Rows config={config} files={files} reload={load} language={i18n.language} />;
  if (failed) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:maintenance.logLoadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => void load()}>
          {t("settingsRows:server.retry")}
        </Button>
      </div>
    );
  }
  return <div style={{ minHeight: 80 }} aria-busy="true" />;
}

function Rows({
  config,
  files,
  reload,
  language,
}: {
  config: LoggingConfigResponse;
  files: LogFileInfo[];
  reload: () => Promise<void>;
  language: string;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const row = useRowCopy("maintenance");
  const dialog = useDialogCopy();
  const fmt = useDisplayFormat();
  const addToast = useToastStore((s) => s.addToast);
  const [viewer, setViewer] = useState<string | null>(null);
  const [asking, setAsking] = useState<"cleanup" | { file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const pinned = config.logLevelSource === "environment";
  const pinnedDep = pinned
    ? { reason: t("settingsRows:maintenance.deps.envPinned", { level: config.effectiveLogLevel }) }
    : undefined;

  // Only what the user edited is sent: the verbose switch above writes the level on
  // its own, and a draft that still holds the old level must not write it back.
  // "Changed" cannot say that (it is measured against a baseline that follows the
  // server), so the edits are recorded as they are made.
  const editedRef = useRef<Set<keyof Draft>>(new Set());
  const group = useGroupSave<Draft>({
    id: "maintenance-logging",
    label: t("settingsRows:maintenance.groups.logging"),
    saved: draftOf(config),
    write: async (draft) => {
      const edited = new Set<keyof Draft>(editedRef.current);
      const { config: next } = await adminApi.updateLoggingConfig({
        ...(edited.has("level") ? { logLevel: draft.level } : {}),
        ...(edited.has("retentionDays") ? { logRetentionDays: Number(draft.retentionDays) } : {}),
        ...(edited.has("http") ? { logHttpRequests: draft.http } : {}),
        ...(edited.has("database") ? { logDatabaseQueries: draft.database } : {}),
        ...(edited.has("parser") ? { logParserOperations: draft.parser } : {}),
      });
      // What was sent is saved; an edit made while the request was out stays recorded.
      for (const field of edited) if (field in draft) editedRef.current.delete(field);
      await reload();
      return draftOf(next);
    },
  });
  const edit = (patch: Partial<Draft>): void => {
    for (const field of Object.keys(patch) as (keyof Draft)[]) editedRef.current.add(field);
    group.edit(patch);
  };
  const footer = {
    ...group,
    discard: (): void => {
      editedRef.current.clear();
      group.discard();
    },
  };
  const days = Number(group.draft.retentionDays);
  const daysInvalid = !Number.isInteger(days) || days < 1 || days > 90;

  const download = async (filename: string): Promise<void> => {
    setFileError(null);
    try {
      const blob = await adminApi.downloadLogFile(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error("Failed to download log file:", error);
      setFileError(logErrorCopy(error, t("admin:toasts.logFileDownloadFailed"), t));
    }
  };

  const confirm = async (): Promise<void> => {
    if (!asking) return;
    setBusy(true);
    setFileError(null);
    try {
      if (asking === "cleanup") {
        const result = await adminApi.cleanupLogs();
        addToast(
          result.failedCount > 0 ? "warning" : "success",
          result.failedCount > 0
            ? t("admin:toasts.cleanupPartial", { failedCount: result.failedCount })
            : t("admin:toasts.cleanupComplete", {
                deletedCount: result.deletedCount,
                freed: formatBytes(result.freedBytes, language),
              })
        );
      } else {
        await adminApi.deleteLogFile(asking.file);
      }
      setAsking(null);
      await reload();
    } catch (error) {
      logger.error("Failed to delete logs:", error);
      setAsking(null);
      setFileError(
        logErrorCopy(
          error,
          t(
            asking === "cleanup" ? "admin:toasts.cleanupFailed" : "admin:toasts.logFileDeletFailed"
          ),
          t
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const level = row("loglevel");
  const keep = row("logtage");
  const http = row("loghttp");
  const db = row("logdb");
  const parser = row("logparser");
  const filesRow = row("logfiles");
  const clean = row("logclean");
  const old = sweepable(files, config.logRetentionDays);
  const asked =
    asking === "cleanup"
      ? dialog("logclean", {
          count: old.count,
          days: config.logRetentionDays,
          size: formatBytes(old.bytes, language),
        })
      : asking
        ? dialog("logdel", { name: asking.file })
        : null;
  const sw = (field: "http" | "database" | "parser", title: string, sub?: string): JSX.Element => (
    <SettingItem
      title={title}
      sub={sub}
      scope="allAccounts"
      expert
      changed={group.isChanged(field)}
      control={
        <SwitchControl checked={group.draft[field]} onChange={(next) => edit({ [field]: next })} />
      }
    />
  );
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem
        title={level.title}
        help={t("admin:logging.help.levels")}
        scope="allAccounts"
        expert
        changed={group.isChanged("level")}
        dependency={pinnedDep}
        control={
          <ChoiceControl<LogLevelName>
            label={level.title}
            value={group.draft.level}
            options={LOG_LEVELS.map((l) => ({ value: l, label: t(`admin:logging.level.${l}`) }))}
            onChange={(next) => edit({ level: next })}
          />
        }
      />
      <MaintenanceDebug24 config={config} reload={reload} dependency={pinnedDep} />
      <SettingItem
        title={keep.title}
        sub={keep.sub}
        scope="allAccounts"
        expert
        changed={group.isChanged("retentionDays")}
        error={
          daysInvalid ? t("settingsRows:maintenance.errors.range", { min: 1, max: 90 }) : undefined
        }
        control={
          <InputControl
            type="number"
            inputMode="numeric"
            value={group.draft.retentionDays}
            onChange={(next) => edit({ retentionDays: next })}
          />
        }
      />
      {sw("http", http.title)}
      {sw("database", db.title)}
      {sw("parser", parser.title)}
      <GroupFooter group={footer} disabled={daysInvalid} />
      <SettingItem title={filesRow.title} sub={filesRow.sub} scope="allAccounts" expert>
        {fileError ? <ErrorLine>{fileError}</ErrorLine> : null}
        {files.length === 0 ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("admin:logging.files.empty")}
          </p>
        ) : (
          <ul className="flex flex-col" style={{ margin: 0, padding: 0 }}>
            {files.map((file) => (
              <li
                key={file.filename}
                className="flex flex-wrap items-center"
                style={{
                  listStyle: "none",
                  gap: "var(--ts-space-md)",
                  padding: "var(--ts-space-sm) 0",
                  borderTop: "1px solid var(--ts-border)",
                }}
              >
                <span className="flex min-w-0 flex-col" style={{ flex: "1 1 220px" }}>
                  <span
                    style={{ fontFamily: "var(--ts-font-mono)", color: "var(--ts-text-bright)" }}
                  >
                    {file.filename}
                  </span>
                  <span className="t-caption">
                    {file.category} · {formatBytes(file.size, language)} ·{" "}
                    {fmt.dateTime(file.modified) || "—"}
                  </span>
                </span>
                <Button variant="secondary" onClick={() => setViewer(file.filename)}>
                  {t("admin:logging.files.view")}
                </Button>
                <Button variant="secondary" onClick={() => void download(file.filename)}>
                  {t("admin:logging.files.download")}
                </Button>
                <Button variant="danger" onClick={() => setAsking({ file: file.filename })}>
                  {t("admin:logging.files.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingItem>
      <LogViewer files={files} selectedFile={viewer} onSelectFile={setViewer} />
      <SettingItem
        title={clean.title}
        scope="allAccounts"
        expert
        control={
          <ActionControl
            danger
            label={clean.title}
            onClick={() => setAsking("cleanup")}
            disabled={old.count === 0}
          />
        }
      >
        {old.count === 0 ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:maintenance.nothingOld")}
          </p>
        ) : null}
      </SettingItem>
      {asked ? (
        <ConfirmDialog
          open
          {...asked}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </div>
  );
}
