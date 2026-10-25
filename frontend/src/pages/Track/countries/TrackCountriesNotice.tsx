import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { countryName } from "../../../shared/geo/countryCode";
import type { CountriesState } from "./useVisitedCountries";

/**
 * What the countries layer shows, in words: the countries coloured (also for
 * a reader who cannot see the map), that they are the touched months'
 * countries, a month still being recomputed, and a failure as itself.
 */
export default function TrackCountriesNotice({
  state,
}: {
  state: CountriesState;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["track"]);
  if (state.kind === "idle") return null;
  if (state.kind === "loading")
    return <p className="t-caption">{t("track:map.countries.loading")}</p>;
  if (state.kind === "failed") {
    return (
      <p
        className="t-caption"
        role="status"
        style={{ color: token("warn") }}
        data-testid="track-countries-failed"
      >
        {t(state.key)}
      </p>
    );
  }
  const names = state.codes.map((c) => countryName(c, i18n.language) || c).join(", ");
  return (
    <div className="flex flex-col gap-1" data-testid="track-countries">
      <p className="t-caption">
        {state.codes.length === 0
          ? t("track:map.countries.none")
          : t("track:map.countries.list", { count: state.codes.length, names })}
      </p>
      <p className="t-caption">{t("track:map.countries.note")}</p>
      {state.pending.length > 0 && (
        <p className="t-caption" role="status" style={{ color: token("warn") }}>
          {t("track:map.countries.pending")}
        </p>
      )}
    </div>
  );
}
