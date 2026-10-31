import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

/**
 * forgejo#383 (PERF-32): the list and the status were polled every 5 s without
 * condition, even in a hidden tab. Fast polling belongs to a running backup;
 * a hidden tab polls nothing.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import { api } from "../../../lib/api/client";
import BackupManagement, { BACKUP_POLL_BUSY_MS, BACKUP_POLL_IDLE_MS } from "../BackupManagement";

function mockGets(running: boolean) {
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/backup") return Promise.resolve({ data: { backups: [] } });
    if (url === "/backup/status")
      return Promise.resolve({
        data: {
          running,
          currentBackup: running ? { id: "b1", status: "running", startedAt: null } : null,
        },
      });
    if (url === "/admin/webdav-settings")
      return Promise.resolve({ data: { settings: { enabled: false } } });
    return Promise.resolve({
      data: { backupEnabled: false, backupInterval: "weekly", backupRetentionDays: 30 },
    });
  }) as never);
}

const statusCalls = (get: ReturnType<typeof mockGets>): number =>
  get.mock.calls.filter(([url]) => url === "/backup/status").length;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("backup polling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls only slowly while no backup runs", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const get = mockGets(false);
    render(<BackupManagement />);
    await settle();
    const initial = statusCalls(get);
    await act(async () => {
      vi.advanceTimersByTime(BACKUP_POLL_BUSY_MS * 3);
    });
    await settle();
    expect(statusCalls(get)).toBe(initial);
    await act(async () => {
      vi.advanceTimersByTime(BACKUP_POLL_IDLE_MS);
    });
    await settle();
    expect(statusCalls(get)).toBe(initial + 1);
  });

  it("polls at the fast rate while a backup is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const get = mockGets(true);
    render(<BackupManagement />);
    await settle();
    const initial = statusCalls(get);
    await act(async () => {
      vi.advanceTimersByTime(BACKUP_POLL_BUSY_MS * 2);
    });
    await settle();
    expect(statusCalls(get)).toBeGreaterThanOrEqual(initial + 2);
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const get = mockGets(true);
    render(<BackupManagement />);
    await settle();
    const initial = statusCalls(get);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      vi.advanceTimersByTime(BACKUP_POLL_BUSY_MS * 4);
    });
    await settle();
    expect(statusCalls(get)).toBe(initial);
  });
});
