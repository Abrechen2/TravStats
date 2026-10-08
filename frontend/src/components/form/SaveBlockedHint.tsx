import type { JSX, ReactNode } from "react";
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
  const { t, i18n } = useTranslation(["common"]);

  const focusField = (field: string): void => {
    const control = document.getElementById(field);
    if (!control) return;
    unfoldAncestors(control);
    control.focus();
  };

  const items = missing.map((step) => (
    <button
      key={`${step.field}|${step.label}`}
      type="button"
      data-inline-action=""
      onClick={() => focusField(step.field)}
      className="underline underline-offset-2 hover:text-[var(--text-primary)]"
    >
      {step.label}
    </button>
  ));

  return (
    <div id={id} aria-live="polite" className="text-xs text-[var(--text-muted)]">
      {missing.length > 0 && (
        <p data-testid="save-blocked-hint">
          {t("common:form.saveBlocked")} {joinAsList(items, i18n.language)}
        </p>
      )}
    </div>
  );
}

interface ListFormatPart {
  type: "element" | "literal";
  value: string;
}
type ListFormatConstructor = new (
  locale: string | undefined,
  options: { style: "long"; type: "conjunction" }
) => { formatToParts: (list: string[]) => ListFormatPart[] };

/**
 * "Name und Position" in German, "Name and position" in English — joined the
 * way the UI language joins a list, not with a comma that reads as English
 * punctuation everywhere. `Intl.ListFormat` gives the separators; the items
 * stay BUTTONS, which is why its parts are interleaved rather than its string
 * used. A browser without it (or a locale it rejects) gets ", ".
 */
function joinAsList(items: ReactNode[], language: string | undefined): ReactNode[] {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor }).ListFormat;
  let parts: ListFormatPart[] | null = null;
  if (ListFormat) {
    try {
      const placeholders = items.map((_, index) => String(index));
      parts = new ListFormat(language, { style: "long", type: "conjunction" }).formatToParts(
        placeholders
      );
    } catch {
      parts = null;
    }
  }
  if (!parts) {
    return items.flatMap((item, index) => (index === 0 ? [item] : [", ", item]));
  }
  let next = 0;
  return parts.map((part) => (part.type === "element" ? items[next++] : part.value));
}
