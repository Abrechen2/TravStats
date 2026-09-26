import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { apiErrorMachineCode } from "../../lib/apiError";
import { useTranslation } from "../../hooks/useTranslation";
import {
  LOG_ERROR_CODES,
  LOG_LEVELS,
  type LogFileEntry,
  type LogFileInfo,
  type LogReadResponse,
} from "../../shared/logContract";

/**
 * A read-only view of one log file: filter by level, category and text, page
 * through it newest first. Reading used to exist only as an API.
 *
 * A failure is shown in the reader's language from the server's stable code
 * (`LOG_FILE_NOT_FOUND`, …) — never the server's English sentence.
 */

const PAGE_SIZE = 50;

interface LogViewerProps {
  files: LogFileInfo[];
  selectedFile: string | null;
  onSelectFile: (filename: string) => void;
}

interface Filters {
  level: string;
  category: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { level: "", category: "", search: "" };

function entryTimeLabel(entry: LogFileEntry, locale: string): string {
  const raw = entry.timestamp ?? entry.time;
  const time = typeof raw === "string" ? new Date(raw) : null;
  return time && !Number.isNaN(time.getTime()) ? time.toLocaleString(locale) : "—";
}

function entryEvent(entry: LogFileEntry): string {
  return entry.operation ?? entry.message ?? "—";
}

export default function LogViewer({
  files,
  selectedFile,
  onSelectFile,
}: LogViewerProps): JSX.Element {
  const { t, i18n } = useTranslation(["admin"]);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LogReadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (filename: string, filters: Filters, from: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminApi.readLogFile(filename, {
          offset: from,
          limit: PAGE_SIZE,
          level: filters.level || undefined,
          category: filters.category.trim() || undefined,
          search: filters.search.trim() || undefined,
        });
        setPage(result);
      } catch (err: unknown) {
        const code = apiErrorMachineCode(err);
        const known = (LOG_ERROR_CODES as readonly string[]).includes(code ?? "");
        setPage(null);
        setError(known ? t(`admin:logging.errors.${code}`) : t("admin:logging.errors.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (selectedFile) void load(selectedFile, applied, offset);
  }, [selectedFile, applied, offset, load]);

  const apply = (): void => {
    setOffset(0);
    setApplied({ ...draft });
  };

  const inputClass =
    "px-3 py-2 bg-(--bg-surface) border border-border rounded-lg text-sm text-(--text-primary)";

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6" data-testid="log-viewer">
      <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
        {t("admin:logging.viewer.title")}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <label className="flex flex-col gap-1 text-xs text-(--text-muted) md:col-span-2">
          {t("admin:logging.viewer.file")}
          <select
            className={inputClass}
            value={selectedFile ?? ""}
            onChange={(e) => {
              setOffset(0);
              onSelectFile(e.target.value);
            }}
          >
            <option value="" disabled>
              {t("admin:logging.viewer.chooseFile")}
            </option>
            {files.map((file) => (
              <option key={file.filename} value={file.filename}>
                {file.filename}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
          {t("admin:logging.viewer.level")}
          <select
            className={inputClass}
            value={draft.level}
            onChange={(e) => setDraft({ ...draft, level: e.target.value })}
          >
            <option value="">{t("admin:logging.viewer.levelAll")}</option>
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
          {t("admin:logging.viewer.category")}
          <input
            className={inputClass}
            value={draft.category}
            placeholder={t("admin:logging.viewer.categoryPlaceholder")}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
          {t("admin:logging.viewer.search")}
          <input
            className={inputClass}
            value={draft.search}
            placeholder={t("admin:logging.viewer.searchPlaceholder")}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </label>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          onClick={apply}
          disabled={!selectedFile}
        >
          {t("admin:logging.viewer.apply")}
        </button>
        {page && page.total > 0 && (
          <>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t("admin:logging.viewer.newer")}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={!page.hasMore || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t("admin:logging.viewer.older")}
            </button>
            <span className="text-xs text-(--text-muted)">
              {t("admin:logging.viewer.range", {
                from: page.offset + 1,
                to: page.offset + page.entries.length,
                total: page.total,
              })}
            </span>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm mb-3" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {loading && (
        <p className="text-sm text-(--text-muted)">{t("admin:logging.viewer.loading")}</p>
      )}
      {!loading && page && page.entries.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("admin:logging.viewer.empty")}</p>
      )}
      {!loading && page && page.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--bg-base)">
              <tr>
                {(["colTime", "colLevel", "colCategory", "colEvent"] as const).map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2 text-left text-xs font-medium text-(--text-muted) uppercase"
                  >
                    {t(`admin:logging.viewer.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry, i) => (
                <tr key={`${page.offset + i}`} className="align-top border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap text-(--text-muted)">
                    {entryTimeLabel(entry, i18n.language)}
                  </td>
                  <td className="px-3 py-2 font-mono">{entry.level ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{entry.category ?? "—"}</td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer font-mono break-all">
                        {entryEvent(entry)}
                      </summary>
                      <pre className="mt-2 text-xs whitespace-pre-wrap break-all text-(--text-muted)">
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
