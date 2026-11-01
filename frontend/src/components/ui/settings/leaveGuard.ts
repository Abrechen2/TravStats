import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { leaveThroughHistory, registerDirtyDialog } from "../../form/unsavedChanges";

/**
 * Groups with an explicit "Speichern" warn before the page is left (B6).
 *
 * The groups register here while they hold unsaved input; everything that can
 * leave the page asks this module first:
 *
 * - a click on any in-app link (menu, search hit, header) — intercepted by the
 *   `LeaveGuardHost`, because the app mounts `<BrowserRouter>` and
 *   react-router's `useBlocker` needs a data router;
 * - a programmatic navigation (a search hit on Enter, the phone menu's select)
 *   through `useGuardedNavigate`;
 * - the browser's Back and a reload — through `form/unsavedChanges`, which
 *   already owns the history sentinel and `beforeunload`.
 *
 * Leaving to another settings page counts: the groups are page-local.
 */
export interface DirtyGroup {
  /** Names the page part in the question: "Adressen auf der Seite Server". */
  label: string;
  /** How many values differ from the saved ones. */
  count: number;
  /** Put the draft back to what was saved. */
  discard: () => void;
}

export interface PendingLeave {
  /** Null when the browser's Back raised the question. */
  to: string | null;
  state?: unknown;
  replace?: boolean;
}

const groups = new Map<string, DirtyGroup>();
let pending: PendingLeave | null = null;
let version = 0;
let unregisterBrowser: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Register (or update) a dirty group. Returns the unregister. */
export function registerDirtyGroup(id: string, group: DirtyGroup): () => void {
  groups.set(id, group);
  if (!unregisterBrowser) {
    unregisterBrowser = registerDirtyDialog({
      askFromHistory: () => {
        pending = { to: null };
        emit();
      },
      isBusy: () => false,
      panel: () => null,
    });
  }
  emit();
  return () => {
    groups.delete(id);
    if (groups.size === 0) {
      // Nothing left to lose: a question about it is stale (and would otherwise
      // outlive its page, to be asked on the next one).
      pending = null;
      unregisterBrowser?.();
      unregisterBrowser = null;
    }
    emit();
  };
}

export function hasDirtyGroups(): boolean {
  return groups.size > 0;
}

export function dirtySummary(): { labels: string[]; count: number } {
  const all = Array.from(groups.values());
  return { labels: all.map((g) => g.label), count: all.reduce((sum, g) => sum + g.count, 0) };
}

/** Leaving to a different page? A move within the page keeps the groups mounted. */
function leavesPage(to: string): boolean {
  try {
    return new URL(to, window.location.href).pathname !== window.location.pathname;
  } catch {
    return true;
  }
}

/** Ask to leave. True when nothing is unsaved and the caller may go on at once. */
export function requestLeave(leave: PendingLeave): boolean {
  if (groups.size === 0 || (leave.to !== null && !leavesPage(leave.to))) return true;
  pending = leave;
  emit();
  return false;
}

export function stayOnPage(): void {
  pending = null;
  emit();
}

/** "Verwerfen": drafts go back to the saved values and the pending move happens. */
export function discardAndLeave(go: (leave: PendingLeave) => void): void {
  const leave = pending;
  pending = null;
  if (leave?.to === null) {
    // Back: the history step first, so the sentinel's removal finds nothing to do.
    leaveThroughHistory();
  }
  Array.from(groups.values()).forEach((g) => g.discard());
  if (leave && leave.to !== null) go(leave);
  emit();
}

export function usePendingLeave(): PendingLeave | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  );
  return pending;
}

/** `navigate`, asking first when a group holds unsaved input. */
export function useGuardedNavigate(): (
  to: string,
  options?: { state?: unknown; replace?: boolean }
) => void {
  const navigate = useNavigate();
  return useCallback(
    (to, options) => {
      if (requestLeave({ to, ...options })) navigate(to, options);
    },
    [navigate]
  );
}
