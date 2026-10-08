import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { unfoldAncestors } from "./requiredFields";

export interface MissingStep {
  /** The DOM id of the control that resolves it — the item focuses it. */
  field: string;
  /** What is missing, in the reader's language: "Name", "gültige Koordinaten". */
  label: string;
}

/**
 * Why the save button is greyed out, said beside it (forgejo#245).
 *
 * A disabled button explains nothing: the lodging form greyed out "Speichern"
 * for an empty name or a bad coordinate and said neither, and the coordinate
 * message sat in a folded section the user had no reason to open. A `title`
 * tooltip does not count — there is no hover on an iPad.
 *
 * - Visible text, so it needs no hover, and `aria-live` so a screen reader
 *   hears it shrink as fields are filled in.
 * - The save button points here with `aria-describedby={id}`, so focusing the
 *   disabled button reads the reason.
 * - Each item is a button that takes the cursor to the field — unfolding a
 *   folded section first, because `focus()` inside a closed `<details>` does
 *   nothing.
 *
 * Renders an EMPTY live region when nothing is missing rather than nothing:
 * a live region that is created together with its content is not announced
 * by most screen readers.
 */
export default function SaveBlockedHint({
  id,
  missing,
}: {
  id: string;
  missing: readonly MissingStep[];
}): JSX.Element {
  const { t } = useTranslation(["common"]);

  const focusField = (field: string): void => {
    const control = document.getElementById(field);
    if (!control) return;
    unfoldAncestors(control);
    control.focus();
  };

  return (
    <div id={id} aria-live="polite" className="text-xs text-[var(--text-muted)]">
      {missing.length > 0 && (
        <p data-testid="save-blocked-hint">
          {t("common:form.saveBlocked")}{" "}
          {missing.map((step, index) => (
            <span key={step.field}>
              {index > 0 && ", "}
              <button
                type="button"
                onClick={() => focusField(step.field)}
                className="underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {step.label}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
