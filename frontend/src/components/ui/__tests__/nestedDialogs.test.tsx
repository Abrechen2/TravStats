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
 */
function TwoDialogs({ onOuterClose }: { onOuterClose: () => void }): JSX.Element {
  const [innerOpen, setInnerOpen] = useState(true);
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

describe("two dialogs open at once", () => {
  it("Escape closes only the top one, so the form underneath survives", async () => {
    const onOuterClose = vi.fn();
    render(<TwoDialogs onOuterClose={onOuterClose} />);

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

    expect(document.body.style.overflow).toBe("hidden");

    // Close the inner one: the outer is still open, so the lock stays.
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow, "one dialog is still open").toBe("hidden");

    unmount();
    expect(document.body.style.overflow, "no dialog is open any more").toBe(before);
  });
});
