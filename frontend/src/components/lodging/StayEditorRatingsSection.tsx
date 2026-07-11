import type { JSX } from "react";
import { StarRatingInput } from "./StarRatingInput";

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
}

/** The four 1–5 half-star pickers (room/breakfast/service/overall) — extracted so StayEditor.tsx stays focused. */
export function StayEditorRatingsSection({
  ratings,
  onChange,
  labels,
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
      <StarRatingInput
        fieldKey="overall"
        label={labels.overall}
        value={ratings.ratingOverall}
        onChange={(v) => onChange({ ratingOverall: v })}
      />
    </div>
  );
}
