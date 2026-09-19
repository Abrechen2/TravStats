import type { JSX } from "react";

/**
 * Marking, and then finding, the fields the flight form cannot do without
 * (forgejo#88, point 9).
 *
 * Before this the form told you what was missing only after you pressed save —
 * and told you in one sentence at the top ("errors:missingTimes") that named no
 * field. The asterisk says which four matter before a key is pressed, and
 * `focusFirstMissingRequired` puts the cursor in the first empty one when the
 * save is refused.
 */

/**
 * The asterisk beside a required field's label.
 *
 * `aria-hidden` on purpose: the semantics belong on the CONTROL, via
 * `aria-required`, and a screen reader reading "star" after every fourth label
 * is noise. The visible mark is for the eye, `aria-required` is for the
 * screen reader, and the legend line below the form explains the mark to
 * whoever reads it.
 */
export function RequiredMark(): JSX.Element {
  return (
    <span aria-hidden="true" style={{ color: "var(--ts-bad)" }}>
      *
    </span>
  );
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const REQUIRED_SELECTOR = [
  'input[aria-required="true"]',
  "input[required]",
  'select[aria-required="true"]',
  'textarea[aria-required="true"]',
].join(", ");

/**
 * Focus the first required control that is still empty, and return it.
 *
 * Document order, which is reading order — "the first thing that is missing" is
 * the only ordering a person can predict. A disabled control is skipped: the
 * airport autocomplete disables itself while the catalogue seeds, and focusing
 * it would move the cursor somewhere the user cannot type.
 *
 * Returns null when nothing is missing, which is also what a caller gets when
 * the form has not rendered yet — the caller decides whether that matters.
 */
export function focusFirstMissingRequired(root: HTMLElement | null): FormControl | null {
  if (!root) return null;

  for (const control of Array.from(root.querySelectorAll<FormControl>(REQUIRED_SELECTOR))) {
    if (control.disabled || control.value.trim() !== "") continue;
    control.focus();
    return control;
  }
  return null;
}
