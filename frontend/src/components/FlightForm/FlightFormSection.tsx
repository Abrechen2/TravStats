import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";

import { readSectionFold, writeSectionFold } from "./sectionFold";

/**
 * One collapsible group of the manual flight form (forgejo#88, point 9).
 *
 * The form asked for 25 fields at once and four of them were required. The
 * owner asked for the stay editor's shape — `<details>` blocks with a heading —
 * with the core open and the rest folded away.
 *
 * Two things it does that `StayEditorSection` does not, and both are the point:
 *
 * **It remembers.** An open state survives closing and reopening the dialog
 * within the session, so somebody who always fills in the seat number opens it
 * once per browser session rather than once per flight. The storage itself is
 * in `sectionFold.ts`, because `focusFirstMissingRequired` unfolds a group too
 * and the two must write the same key.
 *
 * **It says what it is hiding.** A collapsed section carries a one-line summary
 * of the fields that are filled, so folding is never the reason a price is
 * forgotten. When nothing is filled there is nothing to summarise, and the line
 * is absent rather than reading "empty" at the user.
 */

interface FlightFormSectionProps {
  /** Stable across renders — it is the storage key. */
  id: string;
  title: string;
  /** Whether the section starts open when the session has no opinion yet. */
  defaultOpen?: boolean;
  /**
   * What is filled in, in one line, shown while the section is closed. Omit or
   * pass an empty string when nothing is filled.
   */
  summary?: string;
  children: ReactNode;
}

export default function FlightFormSection({
  id,
  title,
  defaultOpen = false,
  summary,
  children,
}: FlightFormSectionProps): JSX.Element {
  // Read once, on mount, rather than on every render: a `useState` initialiser
  // runs once, which is exactly the "what did this session decide" question.
  const [open, setOpen] = useState<boolean>(() => readSectionFold(id) ?? defaultOpen);

  // An id that changes must not keep the previous section's fold.
  useEffect(() => {
    setOpen(readSectionFold(id) ?? defaultOpen);
  }, [id, defaultOpen]);

  const handleToggle = useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>): void => {
      const next = event.currentTarget.open;
      setOpen(next);
      writeSectionFold(id, next);
    },
    [id]
  );

  return (
    <details
      open={open}
      onToggle={handleToggle}
      data-section={id}
      style={{
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        padding: "var(--ts-space-lg)",
      }}
    >
      {/* The summary line lives INSIDE <summary>, not beside it: a closed
          <details> hides every child except the first <summary>, so a sibling
          paragraph would be visible exactly when it is not needed and hidden
          exactly when it is. */}
      <summary className="cursor-pointer">
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {title}
        </span>
        {!open && summary ? (
          <span className="t-caption" style={{ display: "block" }}>
            {summary}
          </span>
        ) : null}
      </summary>
      <div style={{ marginTop: "var(--ts-space-lg)" }}>{children}</div>
    </details>
  );
}
