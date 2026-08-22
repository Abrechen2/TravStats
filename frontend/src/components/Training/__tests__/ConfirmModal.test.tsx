/**
 * What these tests can and cannot prove.
 *
 * The defect they exist for was a STACKING one: the backdrop is `fixed` and the
 * dialog body was not positioned at all, so the backdrop covered the buttons.
 * Every click landed on it, and because the backdrop closes the dialog, the
 * confirm button read as "worked" while nothing happened. jsdom has no layout
 * and no hit-testing, so no assertion here could have caught that — only a
 * browser can (`document.elementFromPoint` on the button's centre must return
 * the button). Found that way on 2.6.0-rc.9.
 *
 * What is pinned below is therefore the STRUCTURE that makes the stacking
 * correct: the body carries its own stacking context above the backdrop, and
 * the backdrop's background class is a real one. The invisible backdrop is what
 * hid the bug for months — the class `bg-[var(--bg-base)]0` was a typo that
 * produced no colour at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmModal from "../ConfirmModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" }, ready: true }),
}));

const base = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  title: "Wirklich löschen?",
  message: "Das lässt sich nicht rückgängig machen.",
  confirmText: "Endgültig löschen",
  cancelText: "Abbrechen",
};

describe("ConfirmModal", () => {
  it("renders nothing while closed", () => {
    render(<ConfirmModal {...base} isOpen={false} />);
    expect(screen.queryByText("Wirklich löschen?")).not.toBeInTheDocument();
  });

  it("is a labelled dialog, so assistive tech announces it as one", () => {
    render(<ConfirmModal {...base} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Wirklich löschen?");
  });

  it("confirming calls onConfirm", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...base} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancelling calls onClose and not onConfirm", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmModal {...base} onClose={onClose} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape closes it", async () => {
    const onClose = vi.fn();
    render(<ConfirmModal {...base} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("both buttons sit in their own stacking context, above the backdrop", () => {
    // The regression guard. A backdrop that is `fixed` outranks an unpositioned
    // sibling no matter the DOM order, so the body must position itself.
    render(<ConfirmModal {...base} />);
    const body = screen.getByRole("button", { name: "Endgültig löschen" }).closest("[class]")!
      .parentElement!.parentElement!;
    expect(body.className).toMatch(/\brelative\b/);
    expect(body.className).toMatch(/\bz-\d+\b/);
  });

  it("the backdrop has a background class that actually exists", () => {
    // `bg-[var(--bg-base)]0` produced no colour — an invisible backdrop that
    // still swallowed every click.
    const { container } = render(<ConfirmModal {...base} />);
    const backdrop = container.querySelector('[data-testid="confirm-modal-backdrop"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.className).not.toMatch(/\]\d/);
  });

  it("clicking the backdrop closes without confirming", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmModal {...base} onClose={onClose} onConfirm={onConfirm} />
    );
    await userEvent.click(container.querySelector('[data-testid="confirm-modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a running action blocks both buttons, so nothing is fired twice", () => {
    render(<ConfirmModal {...base} isLoading={true} />);
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "training:modal.processing" })).toBeDisabled();
  });
});
