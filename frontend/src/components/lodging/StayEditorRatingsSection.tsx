import { useState, type JSX } from "react";
import { StarRatingInput } from "./StarRatingInput";
import { StarRating } from "./StarRating";
import { RatingCategoriesManager } from "./RatingCategoriesManager";

export interface RatingCategoryField {
  /** Built-in key or `custom:<id>`. */
  key: string;
  label: string;
}

interface StayEditorRatingsSectionProps {
  /** category -> value the stay carries right now. */
  values: Record<string, number>;
  /** The categories the account has switched on (built-in and own), in display order. */
  active: RatingCategoryField[];
  /**
   * Categories the stay still carries a value for although they are no longer
   * offered (switched off, or an own category deleted). Shown, not hidden:
   * they keep counting in the overall until the user clears them.
   */
  retired: RatingCategoryField[];
  onChange: (key: string, value: number | null) => void;
  /** The derived overall, DISPLAYED here and never written back. */
  overall: number | null;
  labels: {
    overall: string;
    /** Copy under the overall value explaining that it is computed, not typed. */
    derivedHint: string;
    none: string;
    retiredTitle: string;
    retiredHint: string;
  };
}

/**
 * The 1-5 half-star pickers of the categories the account has switched on,
 * plus the OVERALL rating, which is DERIVED rather than typed.
 *
 * Alex asked for the derivation (Discord 2026-07-12). The overall score used to
 * be a fourth identical picker, so a stay could carry 5/5/5 with an overall of 2
 * and nothing in the product would notice. This component never writes it back.
 *
 * `overall` is DISPLAYED, not recomputed here. The parent already derives it
 * through `shared/ratingDerivation.ts` - the same function the server runs on
 * save - and a second derivation in this component was how the rule ended up
 * living in the UI in the first place, correct only for stays typed into this
 * form and silently absent from both import paths.
 */
export function StayEditorRatingsSection({
  values,
  active,
  retired,
  onChange,
  overall,
  labels,
}: StayEditorRatingsSectionProps): JSX.Element {
  const [managing, setManaging] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {active.length === 0 && (
          <span className="col-span-2 text-xs text-[var(--text-muted)] sm:col-span-3">
            {labels.none}
          </span>
        )}
        {active.map((field) => (
          <StarRatingInput
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            value={values[field.key] ?? null}
            onChange={(v) => onChange(field.key, v)}
          />
        ))}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">{labels.overall}</span>
          <span data-testid="stay-editor-overall">
            <StarRating value={overall} className="text-lg leading-none" />
          </span>
          <span
            data-testid="stay-editor-overall-hint"
            className="text-[10px] text-[var(--text-muted)]"
          >
            {labels.derivedHint}
          </span>
        </div>
      </div>

      {retired.length > 0 && (
        <div data-testid="stay-editor-retired-ratings" className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">
            {labels.retiredTitle}
          </span>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {retired.map((field) => (
              <StarRatingInput
                key={field.key}
                fieldKey={field.key}
                label={field.label}
                value={values[field.key] ?? null}
                onChange={(v) => onChange(field.key, v)}
              />
            ))}
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">{labels.retiredHint}</span>
        </div>
      )}

      <RatingCategoriesManager open={managing} onOpenChange={setManaging} />
    </div>
  );
}
