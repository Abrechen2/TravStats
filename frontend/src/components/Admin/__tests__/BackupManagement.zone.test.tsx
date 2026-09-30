import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";
import commonDe from "../../../i18n/resources/de/common.json";

/**
 * The backup hour's zone (ADR 0002, owner decision 2 on the plan): an admin
 * setting, defaulting to the host zone the instance always ran in. The server
 * stored and applied it (`PUT /admin/backup-settings` `backupZone`,
 * `/health` `scheduler.backupZone`), but no screen could set it, and the page
 * still said backups run at "2:00 UTC".
 */

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const bundle = key.startsWith("common:") ? commonDe : adminDe;
      const raw = resolve(bundle, key.replace(/^(admin|common):/, ""));
      if (typeof raw !== "string") return key;
      return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
    },
  }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import { api } from "../../../lib/api/client";
import BackupManagement from "../BackupManagement";

const SETTINGS = {
  backupEnabled: true,
  backupInterval: "daily",
  backupRetentionDays: 30,
  backupZone: null,
  backupZoneEffective: "Europe/Berlin",
  hostZone: "Europe/Berlin",
};

function mockGets() {
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/backup") return Promise.resolve({ data: { backups: [] } });
    if (url === "/backup/status")
      return Promise.resolve({ data: { running: false, currentBackup: null } });
    if (url === "/admin/webdav-settings")
      return Promise.resolve({ data: { settings: { enabled: false } } });
    return Promise.resolve({ data: SETTINGS });
  }) as never);
}

describe("the backup hour's zone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("shows the zone the backup hour is read in and saves a chosen one", async () => {
    mockGets();
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { ...SETTINGS, backupZone: "Asia/Tokyo", backupZoneEffective: "Asia/Tokyo" },
    } as never);
    render(<BackupManagement />);

    expect(await screen.findByText(/um 2:00 Uhr in Europe\/Berlin/)).toBeTruthy();
    const select = screen.getByLabelText(adminDe.backup.schedule.zone) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: commonDe.buttons.save }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/admin/backup-settings",
        expect.objectContaining({ backupZone: "Asia/Tokyo" })
      )
    );
    expect(await screen.findByText(/um 2:00 Uhr in Asia\/Tokyo/)).toBeTruthy();
  });

  it("sends null for the server's own zone, and a refused zone reads in German", async () => {
    mockGets();
    const put = vi.spyOn(api, "put").mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { error: "Invalid zone", code: "ZONE_UNKNOWN" } },
    });
    render(<BackupManagement />);
    await screen.findByText(/um 2:00 Uhr in Europe\/Berlin/);
    fireEvent.click(screen.getByRole("button", { name: commonDe.buttons.save }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/admin/backup-settings",
        expect.objectContaining({ backupZone: null })
      )
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", commonDe.saveErrors.zoneUnknown)
    );
  });
});
