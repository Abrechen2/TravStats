import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { getVisitDateSuggestions } from "../../lib/api/places";
import { logger } from "../../lib/logger";
import type { VisitDateSuggestion } from "../../types/place";

interface VisitDateChipsProps {
  placeId: string;
  /** The trip chosen in the form, or "" — a trip narrows the suggestions. */
  tripId: string;
  /** The date field's value; chips show only while it is empty. */
  value: string;
  onPick: (date: string) => void;
}

/**
 * Dates a new visit could carry, from the user's own stays, arrivals and
 * photographs near the place. Offered under the empty date field and never
 * written: once a date is there, typed or picked, the chips step aside.
 *
 * A failed request shows nothing — the date field works exactly as before, and
 * a suggestion is not something the user asked for.
 */
export function VisitDateChips({
  placeId,
  tripId,
  value,
  onPick,
}: VisitDateChipsProps): JSX.Element | null {
  const { t } = useTranslation(["places", "common"]);
  const [suggestions, setSuggestions] = useState<VisitDateSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSuggestions([]);
    void (async () => {
      try {
        const rows = await getVisitDateSuggestions(placeId, tripId || null);
        if (!cancelled) setSuggestions(rows);
      } catch (err) {
        logger.error({ err }, "VisitDateChips: could not load suggestions");
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [placeId, tripId]);

  if (value !== "" || suggestions.length === 0) return null;

  const describe = (s: VisitDateSuggestion): string | null => {
    const parts: string[] = [];
    if (s.source === "flight" && s.label)
      parts.push(t("places:detail.dateSuggestionArrival", { airport: s.label }));
    else if (s.label) parts.push(s.label);
    if (s.photoCount) parts.push(t("places:detail.dateSuggestionPhotos", { count: s.photoCount }));
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  return (
    <div className="mt-2">
      <span className="t-caption">{t("places:detail.dateSuggestions")}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {suggestions.map((s) => {
          const detail = describe(s);
          return (
            <button
              key={s.date}
              type="button"
              onClick={() => onPick(s.date)}
              aria-label={t("common:suggestionChip", {
                field: t("places:detail.date"),
                value: s.date,
              })}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
            >
              {s.date}
              {detail ? ` · ${detail}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
