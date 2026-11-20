import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { usePlaceColorStore } from "../../store/placeColorStore";
import { resolvePlaceColor } from "../../lib/placeColor";

/**
 * The trip's places could not be loaded. Said on the trip, with a way to try
 * again — an empty timeline and map would read as "no places on this trip".
 */
export function TripPlacesError({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useTranslation(["trips"]);
  return (
    <p role="alert" data-testid="trip-places-error" className="mb-2 text-sm text-(--text-muted)">
      {t("trips:tripPlaces.loadError")} ·{" "}
      <button type="button" onClick={onRetry} className="underline cursor-pointer">
        {t("trips:tripPlaces.retry")}
      </button>
    </p>
  );
}

/** The "Orte" row of the trip map's legend, in the colour the dots are drawn. */
export function TripPlacesLegend(): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const config = usePlaceColorStore((s) => s.config);
  const swatch = `rgb(${resolvePlaceColor({ visited: true }, config).join(" ")})`;
  return (
    <ul aria-label={t("trips:tripPlaces.legend")} className="mb-2 flex flex-wrap gap-3 text-sm">
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: swatch }}
        />
        {t("trips:tripPlaces.legend")}
      </li>
    </ul>
  );
}
