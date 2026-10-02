import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { rentalLinksApi, type RentalSuggestions } from "../../lib/api/rentalLinks";
import { logger } from "../../lib/logger";
import type { RentalBooking } from "../../types/rental";

interface Props {
  rental: RentalBooking;
  onChanged: () => void;
  /**
   * The stations offered to a just-linked roadtrip, as a sentence. Handed up
   * because `onChanged` reloads the page, which would take this banner — and
   * the offer in it — off screen before anyone read it.
   */
  onStationOffer: (sentence: string) => void;
}

/**
 * What a rental could belong to (spec 2026-10-01-rental-domain-design §7.1,
 * §7.2; concept page 2026-10-01): a trip its days overlap, and a roadtrip in
 * the same days that this car may have driven. OFFERED, never applied by
 * itself (D2): each needs the user's click, and "not this one" hides it.
 * A failed load or save says so instead of looking like "nothing to suggest".
 */
export function RentalSuggestionBanner({
  rental,
  onChanged,
  onStationOffer,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["rental"]);
  const [suggestions, setSuggestions] = useState<RentalSuggestions | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    rentalLinksApi
      .suggestions(rental.id)
      .then((s) => {
        if (!cancelled) setSuggestions(s);
      })
      .catch((err: unknown) => {
        logger.warn("RentalSuggestionBanner: suggestions failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rental.id, rental.tripId, rental.routeId]);

  const act = async (run: () => Promise<void>): Promise<void> => {
    try {
      await run();
      onChanged();
    } catch (err: unknown) {
      logger.error("RentalSuggestionBanner: link failed", err);
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <p role="alert" className="t-caption text-(--danger)">
        {t("rental:suggest.failed")}
      </p>
    );
  }
  if (!suggestions) return null;
  const trips = rental.tripId ? [] : suggestions.trips.filter((x) => !dismissed.includes(x.id));
  const roadtrips = rental.routeId
    ? []
    : suggestions.roadtrips.filter((x) => !dismissed.includes(x.id));
  if (trips.length === 0 && roadtrips.length === 0) return null;

  return (
    <div
      className="space-y-2 rounded-md border p-3 text-sm"
      style={{ borderColor: "var(--ts-domain-rental)" }}
      data-testid="rental-suggestions"
    >
      {trips.map((trip) => (
        <div key={trip.id} className="flex flex-wrap items-center gap-2">
          <span>{t("rental:suggest.trip", { name: trip.name })}</span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1"
            onClick={() =>
              void act(async () => void (await rentalApi.update(rental.id, { tripId: trip.id })))
            }
          >
            {t("rental:suggest.linkTrip")}
          </button>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setDismissed((d) => [...d, trip.id])}
          >
            {t("rental:suggest.notThis")}
          </button>
        </div>
      ))}
      {roadtrips.map((route) => (
        <div key={route.id} className="flex flex-wrap items-center gap-2">
          <span>{t("rental:suggest.roadtrip", { name: route.name })}</span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1"
            onClick={() =>
              void act(async () => {
                const { stationOffer } = await rentalLinksApi.setRoadtrip(rental.id, route.id);
                if (stationOffer) {
                  onStationOffer(
                    t("rental:suggest.stationOffer", {
                      first: stationOffer.first.name,
                      last: stationOffer.last.name,
                    })
                  );
                }
              })
            }
          >
            {t("rental:suggest.linkRoadtrip")}
          </button>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setDismissed((d) => [...d, route.id])}
          >
            {t("rental:suggest.notThis")}
          </button>
        </div>
      ))}
    </div>
  );
}
