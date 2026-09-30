import { useState } from "react";
import type { JSX } from "react";

import SuggestionChips from "../common/SuggestionChips";
import { useTranslation } from "../../hooks/useTranslation";
import {
  isOpenDataDisabled,
  openDataApi,
  WEATHER_SERVICE_FAILURES,
  type WeatherOutcome,
} from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { formatObservedWeather } from "../../lib/observedWeather";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import type { ObservedWeather, TripJournalEntry } from "../../types";

const BUTTON =
  "px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent) disabled:opacity-50";

/**
 * The measured weather of ONE journal entry's day, under the entry's own
 * weather field (2026-09-25). The measured value and the author's words are
 * kept apart on purpose (`observed_weather` vs `weather`, and the trip
 * statistics count only the latter), so the measurement is shown and offered
 * as a chip — it becomes the entry's own text only when the author clicks it.
 *
 * Gated like the trip-level "fill weather" button: nothing at all while the
 * instance's open data switch is off. Only a saved entry can be asked about,
 * because the server measures the STORED date at the trip's stop for that day;
 * a new entry, or a changed date, gets its weather on save anyway, so the
 * reason is said instead of a button that would fetch the wrong day.
 */
/** The sentence for a lookup that brought no new weather. */
function weatherOutcomeKey(outcome: WeatherOutcome, keptStored: boolean): string {
  if (WEATHER_SERVICE_FAILURES.has(outcome)) {
    return keptStored
      ? `openData:weather.outcome.${outcome}Kept`
      : `openData:weather.outcome.${outcome}`;
  }
  if (outcome === "noLocation") return "openData:weather.noPlace";
  if (outcome === "disabled") return "openData:weather.disabled";
  return `openData:weather.outcome.${outcome}`;
}

export default function JournalWeatherFetch({
  tripId,
  entry,
  date,
  weather,
  onPick,
}: {
  tripId: string;
  entry: TripJournalEntry | null;
  /** The form's date, YYYY-MM-DD. */
  date: string;
  /** The form's own weather text. */
  weather: string;
  onPick: (value: string) => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["openData", "trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const [observed, setObserved] = useState<ObservedWeather | null>(entry?.observedWeather ?? null);
  /** What the last lookup came to, when it brought no weather. */
  const [missing, setMissing] = useState<WeatherOutcome | null>(null);
  const [fetching, setFetching] = useState(false);

  if (!openData) return null;

  const hint = (text: string): JSX.Element => (
    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
      {text}
    </p>
  );
  if (!entry) return hint(t("openData:weather.onSave"));
  if (entry.date.slice(0, 10) !== date) return hint(t("openData:weather.onSaveNewDate"));

  const fetchWeather = async (): Promise<void> => {
    setFetching(true);
    try {
      // A failed lookup comes back with the STORED weather (the server keeps
      // it), so what is shown stays what is known, and the reason is said
      // beside it — a busy weather service used to read "no place".
      const { entry: stored, weatherOutcome } = await openDataApi.refreshEntryWeather(
        tripId,
        entry.id
      );
      setObserved(stored.observedWeather ?? null);
      setMissing(weatherOutcome === "observed" ? null : weatherOutcome);
    } catch (err) {
      logger.warn("Fetching one journal entry's weather failed", err);
      addToast(
        "error",
        isOpenDataDisabled(err) ? t("openData:weather.disabled") : t("openData:weather.failed")
      );
    } finally {
      setFetching(false);
    }
  };

  const measured = observed ? formatObservedWeather(observed, t, i18n.language) : null;
  return (
    <div className="mt-1 space-y-1">
      <button
        type="button"
        onClick={() => void fetchWeather()}
        disabled={fetching}
        className={BUTTON}
        style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
      >
        {fetching ? t("openData:weather.filling") : t("openData:weather.fetchOne")}
      </button>
      {missing !== null && hint(t(weatherOutcomeKey(missing, observed !== null)))}
      {observed && measured && (
        <>
          {hint(`${t("openData:weather.measuredAt", { place: observed.place })}: ${measured}`)}
          <SuggestionChips
            value={weather}
            suggestions={[measured]}
            onPick={onPick}
            fieldLabel={t("trips:journalModal.weatherLabel")}
          />
        </>
      )}
    </div>
  );
}
