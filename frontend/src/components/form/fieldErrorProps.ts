/**
 * The two attributes that tie a control to the message about it (forgejo#246).
 *
 * A red line under a field is visible and nothing more: a screen reader that
 * lands on the control hears its label and not the complaint, and
 * `focusFirstError` has no way to find "the field that is wrong". With these,
 * the control announces itself as invalid and reads the message as its
 * description. The id convention is `${id}-error`, which `FieldError` renders.
 *
 * Returns no `aria-invalid` for a valid field, so it can be spread
 * unconditionally: `<input id={id} {...fieldErrorProps(id, error)} />`.
 * A control that already has a description (a hint line) passes it as
 * `existingDescribedBy`: the error is ADDED to it, never put in its place —
 * spreading after a plain `aria-describedby` would silently drop the hint.
 */
export function fieldErrorProps(
  id: string,
  error: string | null | undefined,
  existingDescribedBy?: string
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  if (!error) return existingDescribedBy ? { "aria-describedby": existingDescribedBy } : {};
  const errorId = fieldErrorId(id);
  return {
    "aria-invalid": true,
    "aria-describedby": existingDescribedBy ? `${existingDescribedBy} ${errorId}` : errorId,
  };
}

/** The id `FieldError` renders and `fieldErrorProps` points at. */
export function fieldErrorId(id: string): string {
  return `${id}-error`;
}
