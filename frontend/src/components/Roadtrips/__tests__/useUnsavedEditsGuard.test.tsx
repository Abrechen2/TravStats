import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { openDirtyDialogCount } from "../../form/unsavedChanges";
import { hasUnsavedEdits, useUnsavedEditsGuard } from "../useUnsavedEditsGuard";
import type { SaveStatus } from "../useStationAutosave";

function Probe({ status }: { status: SaveStatus | null }): null {
  useUnsavedEditsGuard({ status, onAsk: () => {} });
  return null;
}

describe("roadtrip editor — warning on unsaved changes when leaving", () => {
  it("treats every status but 'saved' as edits the server does not hold", () => {
    expect(hasUnsavedEdits("saved")).toBe(false);
    for (const s of ["pending", "saving", "error", "waiting", "conflict"] as const) {
      expect(hasUnsavedEdits(s)).toBe(true);
    }
  });

  it("asks before the tab closes while a save failed, and not when everything is saved", () => {
    const { rerender, unmount } = render(<Probe status="saved" />);
    expect(openDirtyDialogCount()).toBe(0);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    rerender(<Probe status="error" />);
    expect(openDirtyDialogCount()).toBe(1);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    unmount();
  });

  it("holds back a click on an in-app link while edits are unsaved, and lets it through otherwise", () => {
    const onAskLink = vi.fn();
    function LinkProbe({ status }: { status: SaveStatus | null }): JSX.Element {
      useUnsavedEditsGuard({ status, onAsk: () => {}, onAskLink });
      return (
        <>
          <a href="/flights">elsewhere</a>
          <a href={window.location.pathname + "#same"}>same page</a>
          <a href="https://example.org/x">external</a>
        </>
      );
    }
    const swallow = (e: Event): void => e.preventDefault();
    document.addEventListener("click", swallow);
    const { rerender, unmount } = render(<LinkProbe status="saved" />);
    expect(fireEvent.click(screen.getByText("elsewhere"))).toBe(false); // swallow ran
    expect(onAskLink).not.toHaveBeenCalled();

    rerender(<LinkProbe status="error" />);
    fireEvent.click(screen.getByText("elsewhere"));
    expect(onAskLink).toHaveBeenCalledWith("/flights");
    onAskLink.mockClear();
    fireEvent.click(screen.getByText("same page"));
    fireEvent.click(screen.getByText("external"));
    expect(onAskLink).not.toHaveBeenCalled();
    unmount();
    document.removeEventListener("click", swallow);
  });
});
