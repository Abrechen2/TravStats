import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RestoreModal } from "../BackupManagement";

/**
 * The restore dialog is a dialog.
 *
 * It was a bare `fixed inset-0` div with a centred panel of fixed height: at
 * 320x568 the panel started at y=-54 and both buttons sat below the viewport,
 * with no scroll region on either the panel or the overlay — the page behind
 * scrolled instead and the dialog stayed cut off. It also announced nothing
 * (`role`, `aria-modal` and a title association all missing), never moved focus
 * into itself and ignored Escape, so a keyboard or screen-reader user stayed on
 * the page underneath (audit finding AUD-037).
 *
 * The frame that answers all of this already existed — `components/Modal` —
 * and this dialog simply did not use it. The assertions are on that contract:
 * a browser measured the clipping, a unit test can only hold what the frame
 * guarantees.
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
  createdAt: "2026-09-01T10:00:00.000Z",
};

const renderDialog = (onClose = vi.fn()) => ({
  onClose,
  ...render(<RestoreModal backup={backup} onClose={onClose} onConfirm={vi.fn()} />),
});

describe("the restore dialog", () => {
  it("announces itself as a modal dialog with a name", () => {
    const { container } = renderDialog();
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const titleId = dialog?.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    // The name points at an element that exists and carries the title.
    expect(container.querySelector(`#${titleId}`)?.textContent).toContain(
      "admin:backup.restore.title"
    );
  });

  it("puts focus inside itself rather than leaving it on the page", () => {
    const { container } = renderDialog();
    expect(document.activeElement).toBe(container.querySelector('[role="dialog"]'));
  });

  it("closes on Escape", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("gives the panel a height limit and its own scroll region", () => {
    const { container } = renderDialog();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;

    // The two properties the 320x568 measurement was about: the panel cannot
    // grow past the viewport, and its body scrolls instead of overflowing it.
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("still labels its own fields", () => {
    // The port must not lose what the dialog already did right.
    const { container } = renderDialog();
    expect(container.querySelector("#restore-scope")).not.toBeNull();
    expect(container.querySelector('label[for="restore-scope"]')).not.toBeNull();
  });
});
