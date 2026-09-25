import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { photoJourneyPreviewUrl, photoJourneysApi } from "../../lib/api/photoJourneys";

interface Props {
  tripId: string;
}

/**
 * The photographs of the photo-library findings that made this trip.
 *
 * Read through the journey row, which is the grant: each tile is the row id
 * and an INDEX, and the proxy looks the asset up itself. Nothing was copied
 * when the finding was accepted, so there is nothing here to delete either —
 * the section is read-only and simply absent when no finding made the trip.
 */
export default function JourneyPhotosSection({ tripId }: Props): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const [journeys, setJourneys] = useState<Array<{ id: string; previewCount: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    photoJourneysApi
      .forTrip(tripId)
      .then((rows) => {
        if (!cancelled) setJourneys(rows);
      })
      .catch((err: unknown) => {
        // A gallery without this section is still a whole gallery; the log
        // keeps the failure traceable without painting an error over it.
        logger.warn("JourneyPhotosSection: could not load the trip's findings", err);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const tiles = journeys.flatMap((journey) =>
    Array.from({ length: journey.previewCount }, (_, index) => ({
      key: `${journey.id}-${index}`,
      url: photoJourneyPreviewUrl(journey.id, index),
    }))
  );
  if (tiles.length === 0) return null;

  return (
    <section>
      <h4
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--text-secondary, var(--text-primary))" }}
      >
        {t("trips:gallery.fromLibrary")}{" "}
        <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
          · {tiles.length}
        </span>
      </h4>
      <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt={t("trips:gallery.fromLibraryAlt")}
            loading="lazy"
            className="w-full aspect-square object-cover rounded-lg"
            style={{ border: "1px solid var(--color-border)" }}
          />
        ))}
      </div>
    </section>
  );
}
