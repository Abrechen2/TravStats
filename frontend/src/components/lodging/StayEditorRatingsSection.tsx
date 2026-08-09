import type { JSX } from "react";
import { StarRatingInput } from "./StarRatingInput";
import { StarRating } from "./StarRating";

export interface StayRatings {
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  ratingOverall: number | null;
}

interface StayEditorRatingsSectionProps {
  ratings: StayRatings;
  onChange: (patch: Partial<StayRatings>) => void;
  labels: { room: string; breakfast: string; service: string; overall: string };
  /** Copy under the overall value explaining that it is computed, not typed. */
  derivedHint: string;
}

/**
 * The three 1–5 half-star pickers (room/breakfast/service) plus the OVERALL
 * rating, which is DERIVED rather than typed.
 *
 * Alex asked for this (Discord 2026-07-12). The overall score used to be a
 * fourth identical picker, so a stay could carry 5/5/5 with an overall of 2
 * and nothing in the product would notice. This component never writes it back
 * through `onChange`, which is why the patch type still allows it but nothing
 * here sends it.
 *
 * `ratings.ratingOverall` is DISPLAYED, not recomputed here. The parent already
 * derives it through `shared/ratingDerivation.ts` — the same function the
 * server runs on save — and a second derivation in this component was how the
 * rule ended up living in the UI in the first place, correct only for stays
 * typed into this form and silently absent from both import paths.
 */
export function StayEditorRatingsSection({
  ratings,
  onChange,
  labels,
  derivedHint,
}: StayEditorRatingsSectionProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StarRatingInput
        fieldKey="room"
        label={labels.room}
        value={ratings.ratingRoom}
        onChange={(v) => onChange({ ratingRoom: v })}
      />
      <StarRatingInput
        fieldKey="breakfast"
        label={labels.breakfast}
        value={ratings.ratingBreakfast}
        onChange={(v) => onChange({ ratingBreakfast: v })}
      />
      <StarRatingInput
        fieldKey="service"
        label={labels.service}
        value={ratings.ratingService}
        onChange={(v) => onChange({ ratingService: v })}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-muted)]">{labels.overall}</span>
        <span data-testid="stay-editor-overall">
          <StarRating value={ratings.ratingOverall} className="text-lg leading-none" />
        </span>
        <span
          data-testid="stay-editor-overall-hint"
          className="text-[10px] text-[var(--text-muted)]"
        >
          {derivedHint}
        </span>
      </div>
    </div>
  );
}
