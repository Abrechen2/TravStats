import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AccountArchiveRows from "../AccountArchiveRows";
import { JobFailedError } from "../../../lib/api/jobs";

/** forgejo#433 — the account archive rows: export downloads, import refuses visibly. */

const api = {
  status: vi.fn(),
  exportArchive: vi.fn(),
  download: vi.fn(),
  importArchive: vi.fn(),
};
const downloadBlob = vi.fn();

vi.mock("../../../hooks/useTranslation", () => ({
  // Interpolated values are echoed, so a reason passed into a sentence stays visible.
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${Object.values(o).join("|")}` : k),
  }),
}));
vi.mock("../../../lib/export", () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));
vi.mock("../../../lib/api/accountArchive", () => ({
  accountArchiveApi: {
    status: () => api.status(),
    exportArchive: () => api.exportArchive(),
    download: (id: string) => api.download(id),
    importArchive: (f: File) => api.importArchive(f),
  },
}));

describe("AccountArchiveRows", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    downloadBlob.mockReset();
    api.status.mockResolvedValue({ empty: true, busy: false, maxBytes: 1_000_000 });
  });

  it("builds the archive and downloads it under the server's file name", async () => {
    const blob = new Blob(["PK"]);
    api.exportArchive.mockResolvedValue({
      exportId: "e1",
      filename: "travstats-account-a-2026-11-21.zip",
      bytes: 2048,
      files: 3,
      missingFiles: 0,
      tables: { flights: 2 },
    });
    api.download.mockResolvedValue(blob);
    render(<AccountArchiveRows />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.archiv.btn" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "travstats-account-a-2026-11-21.zip")
    );
    expect(api.download).toHaveBeenCalledWith("e1");
  });

  it("says when files were already missing, instead of a plain success", async () => {
    api.exportArchive.mockResolvedValue({
      exportId: "e2",
      filename: "a.zip",
      bytes: 10,
      files: 0,
      missingFiles: 2,
      tables: {},
    });
    api.download.mockResolvedValue(new Blob(["PK"]));
    render(<AccountArchiveRows />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.archiv.btn" }));
    expect(await screen.findByText(/accountArchive\.missingFiles\|2/)).toBeInTheDocument();
  });

  it("lists every omitted file with its reason, not as a generic missing-file note", async () => {
    api.exportArchive.mockResolvedValue({
      exportId: "e3",
      filename: "a.zip",
      bytes: 10,
      files: 0,
      missingFiles: 2,
      omittedFiles: [
        { dir: "receipts", name: "r.pdf", reason: "not_owned" },
        { dir: "documents", name: "d.pdf", reason: "not_found" },
      ],
      tables: {},
    });
    api.download.mockResolvedValue(new Blob(["PK"]));
    render(<AccountArchiveRows />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.archiv.btn" }));
    expect(
      await screen.findByText(
        /receipts\/r\.pdf \(settings:accountArchive\.omittedReason\.not_owned\)/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/documents\/d\.pdf \(settings:accountArchive\.omittedReason\.not_found\)/)
    ).toBeInTheDocument();
  });

  it("names the reason an export failed (too large)", async () => {
    api.exportArchive.mockRejectedValue(new JobFailedError("ACCOUNT_ARCHIVE_TOO_LARGE", 413));
    render(<AccountArchiveRows />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.archiv.btn" }));
    expect(
      await screen.findByText(/settings:accountArchive.failed.ACCOUNT_ARCHIVE_TOO_LARGE/)
    ).toBeInTheDocument();
  });

  it("disables the import and says why when the account already holds data", async () => {
    api.status.mockResolvedValue({ empty: false, busy: false, maxBytes: 1_000_000 });
    render(<AccountArchiveRows />);
    expect(await screen.findByText("settings:accountArchive.notEmpty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settingsRows:data.archivein.btn" })).toBeDisabled();
  });

  it("warns what stays behind (links to the old Immich/PhotoPrism, shares, sign-ins)", async () => {
    render(<AccountArchiveRows />);
    expect(await screen.findAllByText("settings:accountArchive.stays")).toHaveLength(2);
  });

  it("imports after confirmation and reports what could not be matched", async () => {
    api.importArchive.mockResolvedValue({
      archiveId: "a",
      files: 2,
      tables: { flights: 1 },
      alreadyImported: false,
      skipped: { cruise_legs: 1 },
      unmatched: 2,
      refusedFiles: 0,
    });
    render(<AccountArchiveRows />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settingsRows:data.archivein.btn" })).toBeEnabled()
    );
    const file = new File(["PK"], "account.zip", { type: "application/zip" });
    fireEvent.change(screen.getByTestId("account-archive-file"), { target: { files: [file] } });
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:accountArchive.confirm.button" })
    );
    expect(
      await screen.findByText(
        /accountArchive\.imported\|1\|2 settings:accountArchive\.partial\|1\|2\|0/
      )
    ).toBeInTheDocument();
    expect(api.importArchive).toHaveBeenCalledWith(file);
  });

  // UAT rc.45 retest D25: a .gpx reached the "restore this archive?" question.
  it("never offers a .gpx for restore, and says what the file is not", async () => {
    render(<AccountArchiveRows />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settingsRows:data.archivein.btn" })).toBeEnabled()
    );
    const gpx = new File(["<gpx/>"], "places.gpx", { type: "application/gpx+xml" });
    fireEvent.change(screen.getByTestId("account-archive-file"), { target: { files: [gpx] } });
    expect(await screen.findByText(/accountArchive\.notArchive/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "settings:accountArchive.confirm.button" })
    ).toBeNull();
    expect(api.importArchive).not.toHaveBeenCalled();
  });
});
