import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { photoJourneyPreviewUrl } from "../../lib/api/photoJourneys";
import type { PhotoJourney } from "../../types/photoJourney";

/**
 * How many thumbnails a row may draw.
 *
 * The scan stores three (`PREVIEW_ASSETS` in `services/photoJourneys/scan.ts`)
 * and the proxy accepts an index up to 63. This cap is what keeps a future
 * bump on the server from silently turning one row into a contact sheet.
 */
const MAX_PREVIEW_THUMBS = 4;

/**
 * A finding's preview strip, addressed by INDEX, never by asset id.
 *
 * Each thumbnail is `GET /photo-journeys/:id/preview/:index/file`. The row is
 * the grant: the caller owns the journey, and the server reads the asset id out
 * of the stored array at that index. The ids travel in the row, so a card
 * COULD put one in a URL — and then owning one journey would be a reader for
 * the whole library, which is exactly what this route refuses. The array is
 * therefore read for its length only.
 */
export default function PhotoJourneyPreviewStrip({
  journey,
}: {
  journey: PhotoJourney;
}): JSX.Element | null {
  const { t } = useTranslation(["dataQuality"]);
  const indexes = journey.previewAssetIds.slice(0, MAX_PREVIEW_THUMBS).map((_, index) => index);
  if (indexes.length === 0) return null;
  return (
    <div className="mt-3 flex gap-2">
      {indexes.map((index) => (
        <img
          key={index}
          src={photoJourneyPreviewUrl(journey.id, index)}
          alt={t("dataQuality:inbox.photoJourneys.thumbAlt", { position: index + 1 })}
          loading="lazy"
          width={72}
          height={72}
          className="rounded-[var(--ts-radius-tile)] object-cover"
          style={{ width: 72, height: 72, background: "var(--ts-surface2)" }}
        />
      ))}
    </div>
  );
}
