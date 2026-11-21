import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

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
