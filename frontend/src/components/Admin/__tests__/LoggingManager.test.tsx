import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import LoggingManager from "../LoggingManager";
import { adminApi } from "../../../lib/api";
import deAdmin from "../../../i18n/resources/de/admin.json";
import type {
  LogFileInfo,
  LoggingConfigResponse,
  LogReadResponse,
  LogStatsResponse,
} from "../../../shared/logContract";

/**
 * The admin log section (audit 2026-09-26, findings 2 and 6), rendered with
 * the real German copy.
 */

function deT(key: string, options?: Record<string, unknown>): string {
  const [ns, path] = key.includes(":") ? key.split(":") : ["admin", key];
  if (ns !== "admin") return key;
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      deAdmin
    );
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
}

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: deT, i18n: { language: "de" } }),
}));

vi.mock("../../../lib/api", () => ({
  adminApi: { readLogFile: vi.fn() },
}));

const config: LoggingConfigResponse = {
  logLevel: "info",
  effectiveLogLevel: "info",
  logLevelSource: "settings",
  maxLogFileSize: 10,
  maxLogFiles: 7,
  logHttpRequests: false,
  logDatabaseQueries: false,
  logParserOperations: false,
  logRetentionDays: 7,
};

const files: LogFileInfo[] = [
  {
    filename: "app.log",
    category: "app",
    size: 2048,
    created: "2026-09-20T08:00:00.000Z",
    modified: "2026-09-26T08:00:00.000Z",
    compressed: false,
  },
];

const stats: LogStatsResponse = {
  totalSize: 2048,
  fileCount: 1,
  oldestLogAt: "2026-09-20T08:00:00.000Z",
  newestLogAt: "2026-09-26T08:00:00.000Z",
  categoryBreakdown: { app: 1 },
};

const noop = () => {};

function renderManager(overrides: Partial<LoggingConfigResponse> = {}) {
  return render(
    <LoggingManager
      loggingConfig={{ ...config, ...overrides }}
      logFiles={files}
      logStats={stats}
      savingLogging={false}
      onSave={noop}
      onToggleDebug={noop}
      onDownload={noop}
      onDelete={noop}
      onCleanup={noop}
      onLoggingConfigChange={noop}
    />
  );
}

function httpError(status: number, body: Record<string, unknown>): AxiosError {
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: body,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoggingManager", () => {
  it("shows the oldest and newest log as dates, not a dash", () => {
    renderManager();
    expect(screen.getByTestId("oldest-log")).toHaveTextContent("Sep 20, 2026");
    expect(screen.getByTestId("newest-log")).toHaveTextContent("Sep 26, 2026");
  });

  it("says when LOG_LEVEL pins the level, and locks the picker", () => {
    renderManager({ logLevel: "debug", effectiveLogLevel: "warn", logLevelSource: "environment" });
    expect(screen.getByTestId("log-level-pinned")).toHaveTextContent(
      "Durch die Umgebungsvariable LOG_LEVEL auf „warn“ festgelegt."
    );
    expect(screen.getByRole("combobox", { name: /Log-Level/ })).toBeDisabled();
  });

  it("warns about debug mode by the level in force, not the stored one", () => {
    renderManager({ logLevel: "debug", effectiveLogLevel: "warn", logLevelSource: "environment" });
    expect(screen.queryByText(deAdmin.logging.debugActive.title)).toBeNull();
  });
});

describe("the log viewer", () => {
  const page = (overrides: Partial<LogReadResponse> = {}): LogReadResponse => ({
    filename: "app.log",
    entries: [
      {
        timestamp: "2026-09-26T10:05:00.000Z",
        level: "warn",
        category: "security",
        operation: "newest_event",
      },
      {
        timestamp: "2026-09-26T10:00:00.000Z",
        level: "info",
        category: "general",
        message: "older line",
      },
    ],
    total: 120,
    offset: 0,
    limit: 50,
    hasMore: true,
    ...overrides,
  });

  it("opens a file newest first and pages to older entries", async () => {
    vi.mocked(adminApi.readLogFile).mockResolvedValue(page());
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    expect(await screen.findByText("newest_event")).toBeInTheDocument();
    expect(screen.getByText("1–2 von 120 (neueste zuerst)")).toBeInTheDocument();

    vi.mocked(adminApi.readLogFile).mockResolvedValue(page({ offset: 50 }));
    await userEvent.click(screen.getByRole("button", { name: "Ältere" }));
    await waitFor(() =>
      expect(adminApi.readLogFile).toHaveBeenLastCalledWith(
        "app.log",
        expect.objectContaining({ offset: 50, limit: 50 })
      )
    );
  });

  it("sends the level, category and text filters", async () => {
    vi.mocked(adminApi.readLogFile).mockResolvedValue(page());
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    await screen.findByText("newest_event");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Level/ }), "warn");
    await userEvent.type(screen.getByRole("textbox", { name: /^Kategorie/ }), "security");
    await userEvent.type(screen.getByRole("textbox", { name: /^Text/ }), "probe");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Filtern" }));
    });

    await waitFor(() =>
      expect(adminApi.readLogFile).toHaveBeenLastCalledWith("app.log", {
        offset: 0,
        limit: 50,
        level: "warn",
        category: "security",
        search: "probe",
      })
    );
  });

  it("shows a missing file in German from the stable code, not the server's English", async () => {
    vi.mocked(adminApi.readLogFile).mockRejectedValue(
      httpError(404, { error: "Log file not found", code: "LOG_FILE_NOT_FOUND" })
    );
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Anzeigen" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(deAdmin.logging.errors.LOG_FILE_NOT_FOUND);
    expect(alert).not.toHaveTextContent("Log file not found");
  });

  it("an unknown failure gets the generic German sentence", async () => {
    vi.mocked(adminApi.readLogFile).mockRejectedValue(httpError(500, { error: "ENOENT: raw" }));
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(deAdmin.logging.errors.loadFailed);
  });
});
