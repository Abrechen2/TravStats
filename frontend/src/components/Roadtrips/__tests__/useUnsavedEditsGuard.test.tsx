import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

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
});
