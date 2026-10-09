import type { JSX, ReactNode } from "react";
import { RequiredMark } from "./requiredFields";
import InferredBadge from "./InferredBadge";

/** The review's input look, on the token layer (the old one painted a raw blue ring). */
export const REVIEW_INPUT =
  "w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-(--accent)";

/**
 * One labelled field of the parser review — the label names its control
 * (forgejo#159) and carries the required mark and the "inferred" note.
 */
export default function ReviewField({
  id,
  label,
  required = false,
  inferredHint = null,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  /** Why the parser's value is a guess — shown beside the label, or nothing. */
  inferredHint?: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-(--text-primary) mb-2">
        {label} {required && <RequiredMark />}
        <InferredBadge show={inferredHint !== null} hint={inferredHint ?? ""} />
      </label>
      {children}
    </div>
  );
}
