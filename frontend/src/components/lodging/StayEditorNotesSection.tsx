import type { JSX } from "react";
import { Field } from "../ui/Field";
import { StayEditorSection } from "./StayEditorSection";

interface StayEditorNotesSectionProps {
  /** How many people the booking covered, as the confirmation states it; null when unstated. */
  guests: number | null;
  companions: string;
  onCompanionsChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** Prefix for the two field ids, from the editor's `useId`. */
  fieldIdPrefix: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  inputClassName: string;
}

/**
 * The free text about a stay: who came along, and anything else worth keeping.
 *
 * Extracted from `StayEditor` for the same reason the rating and price blocks
 * were — that file is at the project's 800-line limit, and the next thing it
 * needed was the delete action in its footer.
 */
export function StayEditorNotesSection({
  guests,
  companions,
  onCompanionsChange,
  notes,
  onNotesChange,
  fieldIdPrefix,
  t,
  inputClassName,
}: StayEditorNotesSectionProps): JSX.Element {
  return (
    <StayEditorSection title={t("lodging:stayEditor.notesSection")}>
      {/* The confirmation says HOW MANY people it covered; it names the
          booker, never the companion. So point at the field rather than
          filling it. Threshold is more than ONE person — the booking that
          prompted this covered two, and a threshold of three would have
          left exactly that case silent. Disappears as soon as a name is
          typed: a hint that stays after it has been acted on is nagging. */}
      {guests != null && guests > 1 && companions.trim().length === 0 && (
        <p data-testid="companions-hint" className="mb-2 text-xs text-[var(--warning)]">
          {t("lodging:stayEditor.companionsHint", { count: guests })}
        </p>
      )}
      <Field label={t("lodging:field.companions")} htmlFor={`${fieldIdPrefix}-companions`}>
        <input
          id={`${fieldIdPrefix}-companions`}
          className={inputClassName}
          value={companions}
          onChange={(e): void => onCompanionsChange(e.target.value)}
        />
      </Field>
      <div className="mt-3">
        <Field label={t("lodging:field.notes")} htmlFor={`${fieldIdPrefix}-notes`}>
          <textarea
            id={`${fieldIdPrefix}-notes`}
            rows={3}
            className={inputClassName}
            value={notes}
            onChange={(e): void => onNotesChange(e.target.value)}
          />
        </Field>
      </div>
    </StayEditorSection>
  );
}
