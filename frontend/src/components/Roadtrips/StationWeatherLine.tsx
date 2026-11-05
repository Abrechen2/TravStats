import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { WEATHER_SERVICE_FAILURES } from "../../lib/api/openData";
import { formatObservedWeather } from "../../lib/observedWeather";
import type { StationWeatherState } from "../../lib/roadtrip/stationWeatherState";

/**
 * One station's weather in the timeline: the measurement when there is one,
 * and — in its own words — why the latest lookup brought nothing new. A
 * service failure beside a measurement says that the measurement stays.
 */
export default function StationWeatherLine({
  state,
}: {
  state: StationWeatherState;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["roadtrips", "openData"]);
  const { weather, problem } = state;
  const problemText = problem
    ? problem === "noLocation"
      ? t("roadtrips:weather.noLocation")
      : problem === "disabled"
        ? t("openData:weather.disabled")
        : t(
            `openData:weather.outcome.${problem}${
              weather && WEATHER_SERVICE_FAILURES.has(problem) ? "Kept" : ""
            }`
          )
    : null;
  if (!weather && !problemText) return null;
  return (
    <div className="flex flex-wrap items-baseline" style={{ gap: 8, fontSize: 13 }}>
      {weather && (
        <span data-testid="station-weather">
          {formatObservedWeather({ ...weather, place: "" }, t, i18n.language)}
        </span>
      )}
      {problemText && (
        <span role="status" style={{ color: "var(--ts-warn)" }}>
          {problemText}
        </span>
      )}
    </div>
  );
}
