/**
 * What the app knows about the browser history it has walked.
 *
 * The browser keeps the real stack but will not show it, so "is the entry
 * behind this one the list the reader came from?" cannot be asked of it. The
 * in-app back link needs exactly that answer: when the entry behind is the
 * list, the honest Back is the browser's own (`navigate(-1)`), which brings the
 * list back with its query and scroll; when the page was opened from a
 * bookmark or a link in a new tab, there is nothing behind it and the link
 * falls back to the list's URL (owner report 2026-11-23).
 *
 * Entries are keyed by React Router's `location.key`, which survives a reload
 * (it lives in `history.state`), and indexed in the order they were pushed.
 */

export interface NavEntry {
  key: string;
  pathname: string;
  search: string;
}

type NavigationKind = "PUSH" | "REPLACE" | "POP";

let entries: NavEntry[] = [];
let index = -1;

export function recordNavigation(entry: NavEntry, kind: NavigationKind): void {
  if (kind === "PUSH" || index === -1) {
    entries = [...entries.slice(0, index + 1), entry];
    index = entries.length - 1;
    return;
  }
  if (kind === "REPLACE") {
    entries = entries.map((existing, i) => (i === index ? entry : existing));
    return;
  }
  // POP: Back or Forward to an entry we may have seen. One we never saw (a
  // reload landed mid-history) starts a fresh, unknown stack — the fallback
  // link is the safe answer there.
  const found = entries.findIndex((existing) => existing.key === entry.key);
  if (found !== -1) {
    index = found;
    entries = entries.map((existing, i) => (i === found ? entry : existing));
  } else {
    entries = [entry];
    index = 0;
  }
}

/** The entry Back would return to, when the app saw it. */
export function previousEntry(): NavEntry | null {
  return index > 0 ? (entries[index - 1] ?? null) : null;
}

/** Test seam: forget everything. */
export function resetNavHistory(): void {
  entries = [];
  index = -1;
}
