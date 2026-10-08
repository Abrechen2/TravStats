import type { JSX } from "react";

/**
 * Marking, and then finding, the fields a form cannot do without.
 *
 * Born in the flight form (forgejo#88, point 9) and moved here for every
 * domain (forgejo#245): before it, a form told you what was missing only after
 * you pressed save — and in one sentence that named no field.
 */

/**
 * The asterisk beside a required field's label.
 *
 * `aria-hidden` on purpose: the semantics belong on the CONTROL, via
 * `aria-required`, and a screen reader reading "star" after every fourth label
 * is noise. The visible mark is for the eye, `aria-required` is for the
 * screen reader, and `RequiredLegend` explains the mark to whoever reads it.
 * Never a literal "*" in a translated label — `requiredMarkNotInCopy.test.ts`.
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
 * Unfold every `<details>` between the control and the form.
 *
 * `focus()` on a control inside a closed `<details>` is a NO-OP — the browser
 * refuses to focus something it is not displaying — so without this a jump to
 * a missing or wrong field does nothing in exactly the case it exists for: the
 * field sits in a folded section, and nothing moves on screen.
 *
 * The `toggle` event is dispatched so a section's own React state follows —
 * otherwise the next render would re-apply its `open={false}` and fold the
 * group back up under the cursor. `onUnfold` lets a form that REMEMBERS its
 * folds (the flight form's `sectionFold`) record the unfold the same way a
 * click on the heading would.
 *
 * Ancestors are walked, not just the nearest one: nesting costs a loop.
 */
export function unfoldAncestors(
  control: Element,
  onUnfold?: (details: HTMLDetailsElement) => void
): void {
  let node: HTMLDetailsElement | null = control.closest("details");
  while (node) {
    if (!node.open) {
      node.open = true;
      onUnfold?.(node);
      node.dispatchEvent(new Event("toggle"));
    }
    node = node.parentElement?.closest("details") ?? null;
  }
}

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
export function focusFirstMissingRequired(
  root: HTMLElement | null,
  onUnfold?: (details: HTMLDetailsElement) => void
): FormControl | null {
  if (!root) return null;

  for (const control of Array.from(root.querySelectorAll<FormControl>(REQUIRED_SELECTOR))) {
    if (control.disabled || control.value.trim() !== "") continue;
    unfoldAncestors(control, onUnfold);
    control.focus();
    return control;
  }
  return null;
}
