import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { TravTrackDay } from "../../lib/api/travtrack";

/**
 * "Ist das dein Zuhause?" — shown when no home is known and a silence of the day began and ended
 * at one spot. It writes nothing itself: the home is set where it always is (Einstellungen →
 * Heimatort), there is no second home store.
 */
export default function HomeSuggestionPrompt({
  suggestion,
}: {
  suggestion: NonNullable<TravTrackDay["homeSuggestion"]>;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  return (
    <p
      className="t-caption flex flex-wrap items-center gap-2"
      data-testid="track-home-suggestion"
      data-lat={suggestion.lat}
      data-lon={suggestion.lon}
    >
      <span>{t("track:homeSuggestion.question")}</span>
      <Link to="/settings/reisearten#home" className="underline">
        {t("track:homeSuggestion.action")}
      </Link>
    </p>
  );
}
