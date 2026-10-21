import type { ReactNode } from "react";

interface AdminSubBlockProps {
  /** A mono sub-heading; omit for a block that only needs the separation. */
  title?: string;
  /** Right-aligned on the heading's line: a status pill, a small action. */
  aside?: ReactNode;
  testId?: string;
  children: ReactNode;
}

/**
 * One part of an admin section that the section frame already wraps in a
 * card (forgejo#321). These parts used to be shadowed cards of their own, so
 * the frame's card would have held a stack of cards. A hairline separates
 * them instead, and only between blocks: which block comes first changes with
 * the settings level, so the rule is `not-first`, not a prop.
 */
export function AdminSubBlock({ title, aside, testId, children }: AdminSubBlockProps): JSX.Element {
  return (
    <div
      className="not-first:border-t not-first:pt-4"
      style={{ borderColor: "var(--ts-border)" }}
      data-testid={testId}
    >
      {(title || aside) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title && <h3 className="t-label-mono">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}
