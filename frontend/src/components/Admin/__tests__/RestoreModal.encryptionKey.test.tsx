import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RestoreModal } from "../BackupManagement";

/**
 * SRV-RESTORE-001 (P1, beta audit 2026-09-20).
 *
 * A full restore onto a freshly initialised instance reported success and left
 * every encrypted credential unreadable: the archive carries the ciphertext,
 * the key that wrote it lives in the secrets directory and is NOT in the
 * archive. Measured on the settings page as `hasKey=true`, `hasAccess=false`,
 * with the Immich connection test answering 400 — nothing anywhere said the
 * restore had lost anything.
 *
 * The server now refuses that restore before writing and asks for an
 * acknowledgement. This holds the dialog's half of that: the acknowledgement
 * is a real gate, not a notice printed beside a button that was already
 * enabled.
 */
const backup = {
  id: "b1",
  type: "full",
  status: "completed",
  backupPath: "/x",
  size: "1",
  retentionDays: 30,
  startedAt: null,
  completedAt: "2026-09-01T10:00:00.000Z",
  errorMessage: null,
  metadata: null,
  syncedToCloud: false,
  cloudSyncAt: null,
  cloudSyncError: null,
  createdAt: "2026-09-01T10:00:00.000Z",
};

/** The dialog's own gate: the word has to be typed before anything else. */
const typeTheConfirmation = (): void => {
  const field = screen.getByPlaceholderText("admin:backup.restore.confirmText");
  fireEvent.change(field, { target: { value: "admin:backup.restore.confirmText" } });
};

const confirmButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "admin:backup.restore.confirmButton" }) as HTMLButtonElement;

describe("the restore dialog and a foreign encryption key", () => {
  it("says nothing about the encryption key until the server has refused one", () => {
    render(<RestoreModal backup={backup} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.queryByText("admin:backup.restore.keyMismatchTitle")).toBeNull();
  });

  it("will not restore over a foreign encryption key until the loss is acknowledged", () => {
    const onConfirm = vi.fn();
    render(
      <RestoreModal backup={backup} onClose={vi.fn()} onConfirm={onConfirm} encryptionKeyMismatch />
    );

    expect(screen.getByText("admin:backup.restore.keyMismatchTitle")).not.toBeNull();

    typeTheConfirmation();
    // The typed word alone used to be the whole gate. It must not be enough
    // here: the archive's stored credentials will be unreadable afterwards.
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("passes the acknowledgement on, so the retry is the one the server allows", () => {
    const onConfirm = vi.fn();
    render(
      <RestoreModal backup={backup} onClose={vi.fn()} onConfirm={onConfirm} encryptionKeyMismatch />
    );

    typeTheConfirmation();
    fireEvent.click(screen.getByLabelText("admin:backup.restore.keyMismatchAcknowledge"));

    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("full", true, true);
  });

  it("does not send an acknowledgement nobody was asked for", () => {
    const onConfirm = vi.fn();
    render(<RestoreModal backup={backup} onClose={vi.fn()} onConfirm={onConfirm} />);

    typeTheConfirmation();
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith("full", true, false);
  });
});
