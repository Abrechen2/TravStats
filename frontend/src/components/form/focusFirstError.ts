import { unfoldAncestors } from "./requiredFields";
import { FORM_ERROR_BANNER_ATTR } from "./FormErrorBanner";

/**
 * After a refused save, take the user to what is wrong (forgejo#246).
 *
 * Measured on 2026-10-08: no form in the app moved anywhere after a failed
 * save. The message appeared — at the bottom of a long scrolling body, or in a
 * folded section — and the user was left to find it.
 *
 * Order: the first control marked `aria-invalid="true"` (document order is
 * reading order), else the form's error banner. Folded `<details>` around it
 * are opened first, because `focus()` inside a closed one does nothing.
 *
 * Call it AFTER the render that shows the errors (a `useEffect` on the error
 * state, or `requestAnimationFrame`), otherwise there is nothing to find yet.
 * Returns what it focused, or null.
 */
export function focusFirstError(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const target =
    root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    root.querySelector<HTMLElement>(`[${FORM_ERROR_BANNER_ATTR}]`);
  if (!target) return null;
  unfoldAncestors(target);
  // jsdom has no layout and no scrollIntoView; a browser always does.
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "center" });
  }
  target.focus();
  return target;
}
