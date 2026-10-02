import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect, vi } from "vitest";

import Modal from "../../components/Modal";

/**
 * forgejo#166: an import preview opens while the "add" chooser — a `Modal` —
 * is still mounted. The chooser is portalled to the end of <body>, so a
 * preview rendered in place sat BEFORE it in the document: it looked on top,
 * but the chooser held focus, kept the Tab trap and answered Escape, and the
 * preview could not be reached without a mouse.
 *
 * Renders `preview` the way `DomainImportPanel` does — as a sibling after the
 * chooser — and asserts what a keyboard user needs: a named modal dialog that
 * takes focus, keeps Tab inside itself, and closes on Escape without closing
 * the chooser underneath.
 */
export async function expectPreviewOwnsTheKeyboard(
  preview: ReactElement,
  name: string | RegExp,
  onCancel: ReturnType<typeof vi.fn>
): Promise<void> {
  const closeChooser = vi.fn();
  render(
    <>
      <Modal open onClose={closeChooser} title="chooser" closeLabel="close chooser">
        <textarea aria-label="chooser text" />
      </Modal>
      {preview}
    </>
  );
  await act(async () => {});

  const dialog = screen.getByRole("dialog", { name });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog.contains(document.activeElement)).toBe(true);

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  expect(focusable.length).toBeGreaterThan(1);
  const last = focusable[focusable.length - 1];
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(focusable[0]);
  fireEvent.keyDown(focusable[0], { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);

  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
  expect(closeChooser).not.toHaveBeenCalled();
}
