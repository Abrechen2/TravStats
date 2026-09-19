import type { JSX, ReactNode } from "react";

/**
 * Two presentational shells of the trip detail page: a panel header and the
 * dashed empty placeholder (the stat tile and side panel went with the
 * round-4 overview, `TripOverview.tsx`). No
 * state, no data, no translation of their own — the page hands them text.
 *
 * Extracted on 2026-09-05 because `TripDetailPage.tsx` sat four lines over
 * its frozen size (the 2026-09-05 revert that put tours back behind the beta
 * switch added them) and the size ratchet, rightly, refused. Four were
 * the pieces with no reason to live in a 1600-line page; two remain.
 */

export function PanelHeader({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="px-4 py-2.5 text-xs uppercase tracking-wide"
      style={{
        color: "var(--text-muted)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

export function Placeholder({ text }: { text: string }): JSX.Element {
  return (
    <div
      className="rounded-xl p-12 text-center text-sm"
      style={{
        background: "var(--bg-surface)",
        border: "1px dashed var(--color-border)",
        color: "var(--text-muted)",
      }}
    >
      {text}
    </div>
  );
}
