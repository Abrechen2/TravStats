import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * R3: every account sees when the server last backed itself up — not only the
 * admin. The admin-only list used to feed this row, so an ordinary account got
 * no row at all; and a failed read must not read as "no backup yet".
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de", getFixedT: () => (k: string) => k },
  }),
}));
vi.mock("../../../lib/profileInstant", () => ({
  profileWallClock: (iso: string) => iso.replace("Z", "").slice(0, 19),
}));
const getInstanceStatus = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/backup", () => ({ backupApi: { getInstanceStatus } }));
vi.mock("../../../lib/api/webdavSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/webdavSync")>()),
  webdavSyncApi: { get: vi.fn().mockReturnValue(new Promise(() => undefined)) },
}));

import BackupSection from "../BackupSection";

const renderIt = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <BackupSection />
      </MemoryRouter>
    );
  });
};

describe("BackupSection — the server's last backup, for every account", () => {
  beforeEach(() => getInstanceStatus.mockReset());
  afterEach(cleanup);

  it("shows the finish time of the last completed backup, with 'your admin takes care of it'", async () => {
    getInstanceStatus.mockResolvedValue({
      completedAt: "2030-02-01T10:15:00.000Z",
      running: false,
    });
    await renderIt();
    expect(screen.getByText("settingsRows:data.srvbackup.t")).toBeInTheDocument();
    expect(screen.getByText("settingsRows:data.srvbackup.s")).toBeInTheDocument();
    expect(await screen.findByText("2030-02-01 10:15")).toBeInTheDocument();
  });

  it("says 'running now' while a backup runs, and 'none yet' when there never was one", async () => {
    getInstanceStatus.mockResolvedValue({ completedAt: null, running: true });
    await renderIt();
    expect(await screen.findByText("settings:backup.instance.running")).toBeInTheDocument();
    cleanup();
    getInstanceStatus.mockResolvedValue({ completedAt: null, running: false });
    await renderIt();
    expect(await screen.findByText("settings:backup.instance.none")).toBeInTheDocument();
  });

  it("a failed read is said, never shown as 'none yet', and 'Erneut versuchen' reads again", async () => {
    getInstanceStatus.mockRejectedValueOnce(new Error("down"));
    await renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:backup.instance.loadFailed"
    );
    expect(screen.queryByText("settings:backup.instance.none")).toBeNull();
    getInstanceStatus.mockResolvedValue({
      completedAt: "2030-02-01T10:15:00.000Z",
      running: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "settings:backup.instance.retry" }));
    expect(await screen.findByText("2030-02-01 10:15")).toBeInTheDocument();
  });
});
