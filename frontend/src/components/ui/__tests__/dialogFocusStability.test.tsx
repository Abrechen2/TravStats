import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDialogChrome } from "../useDialogChrome";

/**
 * Focus inside an open dialog stays where the user (or the dialog) put it.
 *
 * Until 2026-10-02 `busy` and `onClose` were dependencies of the hook's one
 * effect, so the end of every save, and every parent render passing a fresh
 * `onClose`, rebuilt it: focus went back to the opener and then onto the panel
 * frame. The flight review's duplicate notice lost its focused link that way.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  // A fresh onClose on every render, as most callers pass one.
  useDialogChrome({ open: true, onClose: () => onClose(), panelRef, busy });
  return (
    <div className="ts-dialog-scrim">
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-label="Test">
        <input aria-label="Field" />
        <button type="button" onClick={() => setBusy((b) => !b)}>
          toggle busy
        </button>
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          rerender
        </button>
      </div>
    </div>
  );
}

describe("useDialogChrome focus stability", () => {
  it("keeps focus on a control when busy flips and when the parent re-renders", () => {
    render(<Harness onClose={vi.fn()} />);
    const field = screen.getByLabelText("Field");

    act(() => field.focus());
    // fireEvent.click does not move focus in jsdom, so the field keeps it
    // unless the hook takes it away.
    act(() => fireEvent.click(screen.getByText("toggle busy")));
    expect(field).toHaveFocus();
    act(() => fireEvent.click(screen.getByText("toggle busy")));
    expect(field).toHaveFocus();

    act(() => fireEvent.click(screen.getByText("rerender")));
    expect(field).toHaveFocus();
  });

  it("still honours busy and the latest onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    act(() => fireEvent.click(screen.getByText("toggle busy")));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    act(() => fireEvent.click(screen.getByText("toggle busy")));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
