import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../../Modal";

/**
 * Two dialogs at once, which is where the shared chrome went wrong.
 *
 * Found in a browser on 2026-09-15: the place form opens the map picker on
 * top of itself, and with a per-dialog Escape listener ONE keypress closed
 * both — discarding a half-filled form the user never asked to leave. The
 * same shape broke the scroll lock: the second dialog saved the value the
 * first had already set to "hidden", so closing both restored "hidden" and
 * the page could not be scrolled again.
 *
 * Neither is reachable with a single dialog, which is why every existing
 * dialog test passed while both were true.
 *
 * The two shapes below are BOTH needed. A dialog can be a CHILD of the one
 * underneath it (the map picker inside the place form) or its SIBLING in the
 * same component (the manual form beside the import panel). The first fix
 * ordered dialogs by React nesting depth, which handles the child and gets the
 * sibling exactly wrong — equal depth, so both answered Escape and the panel
 * underneath closed with the top one. Measured in a browser: with equal
 * z-index the LAST scrim in document order is what paints on top and what
 * `elementFromPoint` returns, in both shapes. That is the rule now.
 */
function TwoDialogs({ onOuterClose }: { onOuterClose: () => void }): JSX.Element {
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <Modal open onClose={onOuterClose} title="Formular">
      <button type="button" onClick={() => setInnerOpen(true)}>
        Karte öffnen
      </button>
      <Modal open={innerOpen} onClose={() => setInnerOpen(false)} title="Karte">
        <p>Punkt wählen</p>
      </Modal>
    </Modal>
  );
}

/** The sibling shape: the inner dialog is NOT inside the outer's children. */
function SiblingDialogs({ onOuterClose }: { onOuterClose: () => void }): JSX.Element {
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      <Modal open onClose={onOuterClose} title="Panel">
        <button type="button" onClick={() => setInnerOpen(true)}>
          Von Hand
        </button>
      </Modal>
      <Modal open={innerOpen} onClose={() => setInnerOpen(false)} title="Formular">
        <p>Eingabe</p>
      </Modal>
    </>
  );
}

describe("two dialogs open at once", () => {
  it("Escape closes only the top one, so the form underneath survives", async () => {
    const onOuterClose = vi.fn();
    render(<TwoDialogs onOuterClose={onOuterClose} />);

    // Opened the way a user opens it — by clicking, in a later commit. That
    // matters: two dialogs mounted in the SAME commit land in the DOM child
    // first, which is a stacking order that cannot look right either, because
    // the scrims share a z-index and the later one paints over the earlier.
    await userEvent.click(screen.getByText("Karte öffnen"));
    expect(screen.getByText("Punkt wählen")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByText("Punkt wählen")).toBeNull();
    expect(
      onOuterClose,
      "the form underneath must NOT have been closed too"
    ).not.toHaveBeenCalled();
    expect(screen.getByText("Karte öffnen")).toBeInTheDocument();
  });

  it("the page scrolls again once the last dialog closes, not the first", async () => {
    const before = document.body.style.overflow;
    const { unmount } = render(<TwoDialogs onOuterClose={() => {}} />);
    await userEvent.click(screen.getByText("Karte öffnen"));

    expect(document.body.style.overflow).toBe("hidden");

    // Close the inner one: the outer is still open, so the lock stays.
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow, "one dialog is still open").toBe("hidden");

    unmount();
    expect(document.body.style.overflow, "no dialog is open any more").toBe(before);
  });

  it("Escape closes only the top one when the two are SIBLINGS, not nested", async () => {
    const onOuterClose = vi.fn();
    render(<SiblingDialogs onOuterClose={onOuterClose} />);

    await userEvent.click(screen.getByText("Von Hand"));
    expect(screen.getByText("Eingabe")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByText("Eingabe")).toBeNull();
    expect(onOuterClose, "the panel underneath must NOT have closed too").not.toHaveBeenCalled();
    expect(screen.getByText("Von Hand")).toBeInTheDocument();
  });
});
