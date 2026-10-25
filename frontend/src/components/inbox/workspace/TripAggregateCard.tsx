import { useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { LocationSuggestion } from "../../../lib/api/locationSuggestions";
import Button from "../../ui/Button";
import { W } from "./model";
import TripSuggestionCard from "./TripSuggestionCard";

const T = `${W}.tripAway`;

/**
 * "Weitere N Zeiträume unterwegs" (TravTrack plan L4): the trip questions
 * beyond the per-run cap, as ONE entry rather than a card each. Nothing is
 * shown of them until the reader asks; then each is answered like any other.
 */
export default function TripAggregateCard({
  suggestions,
  disabled,
  reload,
}: {
  suggestions: LocationSuggestion[];
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{t(`${T}.more`, { count: suggestions.length })}</h3>
      <p className="t-caption">{t(`${T}.moreHint`)}</p>
      <Button aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t(open ? `${T}.hideMore` : `${T}.showMore`)}
      </Button>
      {open && (
        <ul className="space-y-4">
          {suggestions.map((s) => (
            <li key={s.id} className="border-t border-(--ts-border) pt-3">
              <TripSuggestionCard suggestion={s} disabled={disabled} reload={reload} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
