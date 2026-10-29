import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";
import commonDe from "../../../i18n/resources/de/common.json";

/** forgejo#363: a failed schedule load must not leave a savable form of defaults. */

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

function mockGets(settings: () => Promise<unknown>) {
  return vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/backup") return Promise.resolve({ data: { backups: [] } });
    if (url === "/backup/status")
      return Promise.resolve({ data: { running: false, currentBackup: null } });
    if (url === "/admin/webdav-settings")
      return Promise.resolve({ data: { settings: { enabled: false } } });
    return settings();
  }) as never);
}

describe("backup schedule load failure (forgejo#363)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("shows the failure with a retry, locks Save, and never PUTs the placeholder defaults", async () => {
    let fail = true;
    mockGets(() =>
      fail
        ? Promise.reject(new Error("503"))
        : Promise.resolve({
            data: { backupEnabled: true, backupInterval: "daily", backupRetentionDays: 14 },
          })
    );
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} } as never);
    render(<BackupManagement />);

    expect(await screen.findByText(adminDe.backup.schedule.loadFailed)).toBeTruthy();
    const save = screen.getByRole("button", { name: commonDe.buttons.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(put).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: commonDe.buttons.retry }));
    await waitFor(() => expect(screen.queryAllByRole("checkbox").length).toBeGreaterThan(0));
    expect(
      (screen.getByRole("button", { name: commonDe.buttons.save }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
