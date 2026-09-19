import type { JSX } from "react";

import { writeSectionFold } from "./sectionFold";

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
 * Unfold every `<details>` between the control and the form.
 *
 * `focus()` on a control inside a closed `<details>` is a NO-OP — the browser
 * refuses to focus something it is not displaying — so without this the fix
 * for a refused save would do nothing in exactly the case it exists for: the
 * user folded the core, pressed Enter, and got the same nameless error as
 * before, with nothing moving on screen.
 *
 * The unfold is persisted the same way a click on the heading is
 * (`writeSectionFold`), and the `toggle` event is dispatched so the section's
 * own React state follows — otherwise the next render would re-apply its
 * `open={false}` and fold the group back up under the cursor.
 *
 * Ancestors are walked, not just the nearest one: the groups do not nest today
 * and a loop costs nothing if they never do.
 */
function unfoldAncestors(control: Element): void {
  let node: HTMLDetailsElement | null = control.closest("details");
  while (node) {
    if (!node.open) {
      node.open = true;
      const id = node.dataset.section;
      if (id) writeSectionFold(id, true);
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
export function focusFirstMissingRequired(root: HTMLElement | null): FormControl | null {
  if (!root) return null;

  for (const control of Array.from(root.querySelectorAll<FormControl>(REQUIRED_SELECTOR))) {
    if (control.disabled || control.value.trim() !== "") continue;
    unfoldAncestors(control);
    control.focus();
    return control;
  }
  return null;
}
