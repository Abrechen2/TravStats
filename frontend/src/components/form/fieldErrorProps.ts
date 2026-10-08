/**
 * The two attributes that tie a control to the message about it (forgejo#246).
 *
 * A red line under a field is visible and nothing more: a screen reader that
 * lands on the control hears its label and not the complaint, and
 * `focusFirstError` has no way to find "the field that is wrong". With these,
 * the control announces itself as invalid and reads the message as its
 * description. The id convention is `${id}-error`, which `FieldError` renders.
 *
 * Returns an empty object for a valid field, so it can be spread
 * unconditionally: `<input id={id} {...fieldErrorProps(id, error)} />`.
 */
export function fieldErrorProps(
  id: string,
  error: string | null | undefined
): { "aria-invalid": true; "aria-describedby": string } | Record<string, never> {
  if (!error) return {};
  return { "aria-invalid": true, "aria-describedby": fieldErrorId(id) };
}

/** The id `FieldError` renders and `fieldErrorProps` points at. */
export function fieldErrorId(id: string): string {
  return `${id}-error`;
}
