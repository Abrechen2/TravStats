import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { useLoggingAdmin } from "../useLoggingAdmin";
import { adminApi } from "../../../lib/api";
import deAdmin from "../../../i18n/resources/de/admin.json";

/**
 * Audit 2026-09-26, finding 6: the cleanup toast read `filesDeleted` and
 * `spaceFreed` while the server sent `deletedCount` — every admin read
 * "undefined Dateien gelöscht, NaN MB freigegeben". Asserted on the German
 * sentence the admin actually gets.
 */

function deT(key: string, options?: Record<string, unknown>): string {
  const path = key.replace(/^admin:/, "");
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      deAdmin
    );
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name]));
}

vi.mock("../../../lib/api", () => ({
  adminApi: {
    cleanupLogs: vi.fn(),
    getLoggingConfig: vi.fn().mockResolvedValue({}),
    getLogFiles: vi.fn().mockResolvedValue({ files: [] }),
    getLogStats: vi.fn().mockResolvedValue({}),
    deleteLogFile: vi.fn(),
  },
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const addToast = vi.fn();
const askConfirm = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  askConfirm.mockResolvedValue(true);
});

describe("useLoggingAdmin — cleanup", () => {
  it("reports how many files were deleted and how much space was freed", async () => {
    vi.mocked(adminApi.cleanupLogs).mockResolvedValue({
      deletedCount: 3,
      freedBytes: 2 * 1024 * 1024,
      failedCount: 0,
      retentionDays: 7,
    });
    const { result } = renderHook(() => useLoggingAdmin(deT, addToast, askConfirm));

    await act(() => result.current.handleCleanupLogs());

    expect(addToast).toHaveBeenCalledWith(
      "success",
      "Aufräumen abgeschlossen: 3 Dateien gelöscht, 2,0 MB freigegeben"
    );
    const text = addToast.mock.calls.map((call) => call[1]).join(" ");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("says a sweep that freed nothing without a fake precision (was '0.00 MB')", async () => {
    vi.mocked(adminApi.cleanupLogs).mockResolvedValue({
      deletedCount: 0,
      freedBytes: 0,
      failedCount: 0,
      retentionDays: 7,
    });
    const { result } = renderHook(() => useLoggingAdmin(deT, addToast, askConfirm));

    await act(() => result.current.handleCleanupLogs());

    expect(addToast).toHaveBeenCalledWith(
      "success",
      "Aufräumen abgeschlossen: 0 Dateien gelöscht, 0 B freigegeben"
    );
  });

  it("says when some files could not be deleted instead of reporting plain success", async () => {
    vi.mocked(adminApi.cleanupLogs).mockResolvedValue({
      deletedCount: 1,
      freedBytes: 1024,
      failedCount: 2,
      retentionDays: 7,
    });
    const { result } = renderHook(() => useLoggingAdmin(deT, addToast, askConfirm));

    await act(() => result.current.handleCleanupLogs());

    expect(addToast).toHaveBeenCalledWith("warning", "2 Dateien konnten nicht gelöscht werden.");
  });

  it("maps a delete failure's stable code to German, never the server's English", async () => {
    vi.mocked(adminApi.deleteLogFile).mockRejectedValue(
      new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 404,
        statusText: "",
        data: { error: "Log file not found", code: "LOG_FILE_NOT_FOUND" },
        headers: {},
        config: { headers: new AxiosHeaders() },
      })
    );
    const { result } = renderHook(() => useLoggingAdmin(deT, addToast, askConfirm));

    await act(() => result.current.handleDeleteLogFile("gone.log"));

    expect(addToast).toHaveBeenCalledWith("error", deAdmin.logging.errors.LOG_FILE_NOT_FOUND);
  });

  // Browser acceptance 2026-09-26: both questions were the browser's native
  // box. They go through the page's own dialog now, and "no" does nothing.
  it("asks through the page's dialog and does nothing on 'no'", async () => {
    askConfirm.mockResolvedValue(false);
    const native = vi.fn(() => true);
    vi.stubGlobal("confirm", native);
    const { result } = renderHook(() => useLoggingAdmin(deT, addToast, askConfirm));

    await act(() => result.current.handleCleanupLogs());
    await act(() => result.current.handleDeleteLogFile("app.log"));

    expect(askConfirm).toHaveBeenCalledTimes(2);
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(native).not.toHaveBeenCalled();
    expect(adminApi.cleanupLogs).not.toHaveBeenCalled();
    expect(adminApi.deleteLogFile).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
