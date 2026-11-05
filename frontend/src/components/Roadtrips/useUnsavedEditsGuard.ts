import { useEffect, useRef } from "react";

import { leavesCurrentPage, linkClickTarget } from "../form/linkClickTarget";
import { registerDirtyDialog } from "../form/unsavedChanges";
import type { SaveStatus } from "./useStationAutosave";

/**
 * Whether the server lacks something the reader did: every status but `saved`
 * (a pause still running, a send under way, a refused save, a station that is
 * not complete, a conflict). The edits are also kept in this browser, but they
 * are not on the server — and "the server is the record".
 */
export function hasUnsavedEdits(status: SaveStatus): boolean {
  return status !== "saved";
}

/**
 * While the roadtrip editor holds edits the server does not have, closing the
 * tab asks (the browser's own `beforeunload` question) and the browser's Back
 * calls `onAsk` instead of leaving — the page shows its question and, on
 * "leave", goes back through `leaveThroughHistory`. Shares the registry every
 * dirty dialog uses, so the two guards cannot attach twice.
 */
export function useUnsavedEditsGuard({
  status,
  onAsk,
  onAskLink,
}: {
  status: SaveStatus | null;
  onAsk: () => void;
  /**
   * A click on an in-app link that would leave the page. The click is held
   * back; the page asks and, on "leave", navigates to `to` itself. Without
   * it, a `<Link>` (menu, breadcrumb) dropped the edits unasked — the
   * history sentinel only sees the browser's Back.
   */
  onAskLink?: (to: string) => void;
}): void {
  const dirty = status !== null && hasUnsavedEdits(status);
  const stateRef = useRef({ status, onAsk, onAskLink });
  useEffect(() => {
    stateRef.current = { status, onAsk, onAskLink };
  });
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent): void => {
      const ask = stateRef.current.onAskLink;
      if (!ask) return;
      const to = linkClickTarget(event);
      if (to === null || !leavesCurrentPage(to)) return;
      // Capture phase: before the router turns the click into a navigation.
      event.preventDefault();
      event.stopPropagation();
      ask(to);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    return registerDirtyDialog({
      askFromHistory: () => stateRef.current.onAsk(),
      isBusy: () => stateRef.current.status === "saving",
      panel: () => null,
    });
  }, [dirty]);
}
