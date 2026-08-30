import { useEffect, useState } from "react";
import type { JSX } from "react";

import { PhotoStrip } from "../common/PhotoStrip";
import {
  deleteLodgingPhoto,
  listLodgingPhotos,
  updateLodgingPhoto,
  uploadLodgingPhotos,
  type LodgingPhoto,
} from "../../lib/api/lodging";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface Props {
  lodgingId: string;
}

/**
 * Photographs of the house.
 *
 * Loaded separately from the lodging itself rather than embedded in it: the
 * detail page fetches the lodging on every visit, and a gallery per row would
 * be a page of joins for a screen that usually has none.
 *
 * A failed load renders NOTHING rather than an empty strip. An empty strip
 * says "no photos here", which is a different claim from "I could not ask" —
 * and the one that invites someone to upload a second copy of what they
 * already have.
 */
export function LodgingPhotoSection({ lodgingId }: Props): JSX.Element | null {
  const { t } = useTranslation(["lodging", "places", "common"]);
  const [photos, setPhotos] = useState<LodgingPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLodgingPhotos(lodgingId);
        if (!cancelled) setPhotos(rows);
      } catch (err) {
        logger.error({ err }, "LodgingPhotoSection: load failed");
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [lodgingId]);

  if (failed || photos === null) return null;

  return (
    <section className="mb-4">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-muted)]">
        {t("lodging:photos.title")}
      </h2>
      <PhotoStrip<LodgingPhoto>
        photos={photos}
        context={`lodging:${lodgingId}`}
        onUpload={(files) => uploadLodgingPhotos(lodgingId, files)}
        onDelete={(photoId) => deleteLodgingPhoto(lodgingId, photoId)}
        onCaption={(photoId, caption) => updateLodgingPhoto(lodgingId, photoId, { caption })}
      />
    </section>
  );
}
