import type { JSX, ReactNode } from "react";

/**
 * The four presentational shells of the trip detail page: a stat tile, a
 * titled side panel, a panel header and the dashed empty placeholder. No
 * state, no data, no translation of their own — the page hands them text.
 *
 * Extracted on 2026-09-05 because `TripDetailPage.tsx` sat four lines over
 * its frozen size (the 2026-09-05 revert that put tours back behind the beta
 * switch added them) and the size ratchet, rightly, refused. These four were
 * the pieces with no reason to live in a 1600-line page.
 */

export function StatTile({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="text-xl font-display font-bold">{value}</div>
      <div
        className="text-[10px] uppercase tracking-wide mt-0.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
    </div>
  );
}

export function SidePanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

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
