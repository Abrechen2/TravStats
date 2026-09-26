import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The two building blocks of an expanded trip-timeline card: a label/value
 * row, and the link out to the entry's own page. Moved out of
 * `pages/TripDetailPage.tsx`, which sits on the file-size ratchet.
 */

export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}): JSX.Element | null {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-2 text-xs py-0.5">
      <span style={{ color: "var(--text-muted)", minWidth: 110 }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

/** The link out of the panel. Always a sibling of the toggle button, never a
 *  child of it — see the note in ExpandableEventCard. */
export function OpenFullLink({ to, label }: { to: string; label: string }): JSX.Element {
  return (
    <Link
      to={to}
      className="inline-block mt-2 rounded-lg px-3 py-1.5 text-xs font-medium"
      style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
    >
      {label} →
    </Link>
  );
}
