/**
 * The contract 48 hand-built overlays could not agree on: how a dialog closes,
 * whether it says it is a dialog, and where focus goes.
 *
 * The click-through test is the important one. A dialog whose backdrop covers
 * its own buttons looks like it worked and does nothing — that shipped once
 * and stayed invisible for months, because every unit test passed while it
 * happened. Screenshots did not catch it either; only asking the browser what
 * is actually at a point did.
 */
import React from "react";
import type { JSX } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../Modal";

afterEach(cleanup);

function open(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Modal open onClose={onClose} title="Wirklich?" footer={<button>Bestätigen</button>} {...props}>
      <p>Inhalt</p>
    </Modal>
  );
  return { onClose, ...utils };
}

describe("Modal", () => {
  it("announces itself as a dialog and takes its name from the title", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Wirklich?");
  });

  it("closes on Escape — 37 of 48 overlays did not", async () => {
    const { onClose } = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click beside it", async () => {
    const { onClose } = open();
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores both while an action is in flight", async () => {
    const { onClose } = open({ busy: true });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the panel above the backdrop, so its buttons stay clickable", () => {
    open();
    // The backdrop is `fixed` and therefore outranks an unpositioned sibling
    // whatever the DOM order. The panel must carry its own stacking context.
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("relative");
    expect(dialog.className).toContain("z-10");
  });

  it("moves focus into the panel rather than onto a destructive button", () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("gives focus back to whatever opened it", async () => {
    function Harness(): JSX.Element {
      const [isOpen, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Öffnen</button>
          <Modal open={isOpen} onClose={() => setOpen(false)} title="Wirklich?">
            <p>Inhalt</p>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Öffnen" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    // Without this the next Tab starts from the top of the page.
    expect(document.activeElement).toBe(opener);
  });

  it("renders nothing at all when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Wirklich?">
        <p>Inhalt</p>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("frees the page scroll again when it goes away", () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
