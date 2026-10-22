import type { ReactNode } from "react";
import { ExpertPill } from "../ui/ExpertPill";

interface AdminSubBlockProps {
  /** A mono sub-heading; omit for a block that only needs the separation. */
  title?: string;
  /** Right-aligned on the heading's line: a status pill, a small action. */
  aside?: ReactNode;
  testId?: string;
  /** Only the expert view draws this block: the blue "Experte" pill beside the title. */
  expert?: boolean;
  children: ReactNode;
}

/**
 * One part of an admin section that the section frame already wraps in a
 * card (forgejo#321). These parts used to be shadowed cards of their own, so
 * the frame's card would have held a stack of cards. A hairline separates
 * them instead, and only between blocks: which block comes first changes with
 * the settings level, so the rule is `not-first`, not a prop.
 */
export function AdminSubBlock({
  title,
  aside,
  testId,
  expert = false,
  children,
}: AdminSubBlockProps): JSX.Element {
  return (
    <div
      className="not-first:border-t not-first:pt-4"
      style={{ borderColor: "var(--ts-border)" }}
      data-testid={testId}
    >
      {(title || aside || expert) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex flex-wrap items-center gap-2">
            {title && <h3 className="t-label-mono">{title}</h3>}
            {expert && <ExpertPill />}
          </span>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}
