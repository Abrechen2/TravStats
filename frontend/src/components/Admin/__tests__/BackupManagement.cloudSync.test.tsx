import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";

/**
 * The admin's half of the never-uploaded bug.
 *
 * `backupApi.syncToCloud` existed and was imported by nothing: no component
 * called it, so `POST /backup/:id/sync` had no caller in the running app and
 * a backup that missed its automatic upload could not be retried from the UI
 * at all. The Cloud column showed a bare "-" with no way to ask why.
 */

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

// The global setup echoes raw keys; this component's German copy is what the
// assertions below are about, so resolve the real bundle instead.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const raw = resolve(adminDe, key.replace(/^admin:/, "").replace(/^common:/, ""));
      if (typeof raw !== "string") return key;
      if (!options) return raw;
      return Object.entries(options).reduce(
        (acc, [name, value]) => acc.replace(new RegExp(`{{${name}}}`, "g"), String(value)),
        raw
      );
    },
  }),
}));

const addToast = vi.fn();
// The component reads the store with a selector, so the mock has to honour it.
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import { api } from "../../../lib/api/client";
import BackupManagement from "../BackupManagement";

const UNSYNCED_BACKUP = {
  id: "backup-1",
  type: "full",
  status: "completed",
  backupPath: "/data/backups/backup-1/backup-1.tar.gz",
  size: "1048576",
  retentionDays: 30,
  startedAt: "2026-09-12T02:00:00.000Z",
  completedAt: "2026-09-12T02:04:00.000Z",
  errorMessage: null,
  metadata: null,
  syncedToCloud: false,
  cloudSyncAt: null,
  cloudSyncError: null,
  createdAt: "2026-09-12T02:00:00.000Z",
  fileExists: true,
};

function mockGets(backups: unknown[], webdavEnabled = true) {
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/backup") return Promise.resolve({ data: { backups } });
    if (url === "/backup/status")
      return Promise.resolve({ data: { running: false, currentBackup: null } });
    if (url === "/admin/webdav-settings")
      return Promise.resolve({
        data: {
          settings: {
            enabled: webdavEnabled,
            url: "https://cloud.example.com/remote.php/dav/files/x/",
            username: "x",
            passwordSet: true,
            backupPath: "/TravStats/backups/",
          },
        },
      });
    return Promise.resolve({
      data: { backupEnabled: false, backupInterval: "weekly", backupRetentionDays: 30 },
    });
  }) as never);
}

describe("uploading a backup by hand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("offers an upload button for a completed backup that is not in the cloud", async () => {
    mockGets([UNSYNCED_BACKUP]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { success: true } } as never);

    render(<BackupManagement />);

    const button = await screen.findByRole("button", { name: "Hochladen" });
    fireEvent.click(button);

    await waitFor(() => expect(post).toHaveBeenCalledWith("/backup/backup-1/sync"));
  });

  it("does not offer it for a backup that is already up there", async () => {
    mockGets([{ ...UNSYNCED_BACKUP, syncedToCloud: true, cloudSyncAt: "2026-09-12T02:05:00Z" }]);
    vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);

    render(<BackupManagement />);

    await screen.findByText("Wiederherstellen");
    expect(screen.queryByRole("button", { name: "Hochladen" })).toBeNull();
  });

  it("does not offer it at all when WebDAV was never configured", async () => {
    // Most instances. A button whose only possible outcome is 409 is clutter.
    mockGets([UNSYNCED_BACKUP], false);

    render(<BackupManagement />);

    await screen.findByText("Wiederherstellen");
    expect(screen.queryByRole("button", { name: "Hochladen" })).toBeNull();
  });

  it("shows the share's own words when the upload is refused", async () => {
    mockGets([UNSYNCED_BACKUP]);
    // A generic "upload failed" would leave the admin exactly where the bug
    // report started: a green connection test and an empty Nextcloud.
    vi.spyOn(api, "post").mockRejectedValue({
      response: { data: { message: "WebDAV share did not answer as expected: 507" } },
    } as never);

    render(<BackupManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "Hochladen" }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", expect.stringContaining("507"))
    );
  });

  it("shows why a previous automatic upload failed", async () => {
    mockGets([
      { ...UNSYNCED_BACKUP, cloudSyncError: "WebDAV share did not answer as expected: 401" },
    ]);

    render(<BackupManagement />);

    const cell = await screen.findByTitle(/401/);
    expect(cell.textContent).toContain("Fehlgeschlagen");
  });
});
