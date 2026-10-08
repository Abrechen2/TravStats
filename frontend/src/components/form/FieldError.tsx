import type { JSX } from "react";
import { fieldErrorId } from "./fieldErrorProps";

/**
 * The message under a field, at the field (forgejo#246). Pair it with
 * `fieldErrorProps(id, error)` on the control — the control then reads this as
 * its description, and `focusFirstError` can find it.
 *
 * `role="alert"` so the complaint is announced when it appears, not only when
 * someone happens to tab back onto the field.
 */
export default function FieldError({
  id,
  error,
}: {
  /** The CONTROL's id; this element gets `${id}-error`. */
  id: string;
  error: string | null | undefined;
}): JSX.Element | null {
  if (!error) return null;
  return (
    <p id={fieldErrorId(id)} role="alert" className="text-xs text-[var(--danger)]">
      {error}
    </p>
  );
}
