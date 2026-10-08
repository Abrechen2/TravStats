import { focusFirstMissingRequired as focusFirstMissing } from "../form/requiredFields";
import { writeSectionFold } from "./sectionFold";

/**
 * The flight form's door to the shared required-field helpers, which started
 * here (forgejo#88, point 9) and moved to `components/form/requiredFields`
 * for every domain (forgejo#245).
 *
 * Kept as a module, not just deleted, because the flight form REMEMBERS which
 * of its groups are open (`sectionFold`): an unfold forced by a refused save is
 * persisted the same way a click on the heading is, keyed by the group's
 * `data-section`. Other forms do not remember their folds and call the shared
 * function directly.
 */
export { RequiredMark } from "../form/requiredFields";

export function focusFirstMissingRequired(
  root: HTMLElement | null
): ReturnType<typeof focusFirstMissing> {
  return focusFirstMissing(root, (details) => {
    const id = details.dataset.section;
    if (id) writeSectionFold(id, true);
  });
}
