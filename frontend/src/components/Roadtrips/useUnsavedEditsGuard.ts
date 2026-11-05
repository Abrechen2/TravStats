import { useEffect, useRef } from "react";

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
}: {
  status: SaveStatus | null;
  onAsk: () => void;
}): void {
  const dirty = status !== null && hasUnsavedEdits(status);
  const stateRef = useRef({ status, onAsk });
  useEffect(() => {
    stateRef.current = { status, onAsk };
  });
  useEffect(() => {
    if (!dirty) return;
    return registerDirtyDialog({
      askFromHistory: () => stateRef.current.onAsk(),
      isBusy: () => stateRef.current.status === "saving",
      panel: () => null,
    });
  }, [dirty]);
}
