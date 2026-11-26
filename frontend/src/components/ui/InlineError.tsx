import type { JSX, ReactNode } from "react";
import { token } from "./tokens";

/**
 * An error that belongs to ONE thing: a field, a row, a small panel.
 *
 * The rule (owner, rc.47): a field error sits at its field, a page error is a
 * `Banner`, and a toast is for success and undo only. This is the first of the
 * three, replacing ~170 hand-written red paragraphs that each picked their own
 * red, size and `role`. It is an alert, so a screen reader announces it when it
 * appears; give the field the same `id` in `aria-describedby`.
 */
export default function InlineError({
  children,
  id,
  className,
  testId,
  tone = "error",
  announce = true,
}: {
  children: ReactNode;
  id?: string;
  /** Spacing only (`mt-2`); the colour and size are the component's. */
  className?: string;
  testId?: string;
  /** `warning` for "this may not work" rather than "this failed". */
  tone?: "error" | "warning";
  /** False when an enclosing `role="alert"` already announces it. */
  announce?: boolean;
}): JSX.Element {
  return (
    <p
      id={id}
      role={announce ? "alert" : undefined}
      data-testid={testId}
      className={`t-caption${className ? ` ${className}` : ""}`}
      style={{ color: token(tone === "warning" ? "warn" : "bad") }}
    >
      {children}
    </p>
  );
}
