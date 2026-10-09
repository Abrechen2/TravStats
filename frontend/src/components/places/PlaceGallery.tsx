import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { setPlaceCover } from "../../lib/api/places";
import type { Place } from "../../types/place";
import type { PlaceVisitPhoto } from "../../types/placeList";

interface Props {
  place: Place;
}

/**
 * Every photograph of every visit, with one of them as the page's lead
 * (package 9, item 3).
 *
 * The lead is the user's choice when they made one (`coverPhotoId`), and
 * otherwise the first photo — of the most recent visit first, because the
 * latest picture of a place is usually the one its owner means. A choice that
 * no longer resolves (the photo was deleted) falls back the same way; the
 * server has already cleared it.
 */
export function PlaceGallery({ place }: Props): JSX.Element | null {
  const { t } = useTranslation(["places"]);
  const [coverId, setCoverId] = useState<string | null>(place.coverPhotoId ?? null);
  /** A cover that could not be saved — said under the gallery, not in a toast. */
  const [coverFailed, setCoverFailed] = useState(false);

  const photos = galleryPhotos(place);
  if (photos.length === 0) return null;
  const lead = photos.find((p) => p.id === coverId) ?? photos[0];

  const choose = async (photoId: string): Promise<void> => {
    const previous = coverId;
    setCoverId(photoId);
    setCoverFailed(false);
    try {
      await setPlaceCover(place.id, photoId);
    } catch (err: unknown) {
      logger.error("PlaceGallery: cover failed", err);
      setCoverId(previous);
      setCoverFailed(true);
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-label={t("places:gallery.title")}>
      <img
        src={lead.url}
        alt={lead.caption ?? t("places:gallery.lead", { name: place.name })}
        className="w-full rounded-[var(--ts-radius-card)] object-cover"
        style={{ maxHeight: 320, border: "1px solid var(--ts-border)" }}
      />
      {photos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => void choose(photo.id)}
              aria-pressed={photo.id === lead.id}
              // What a tap does is in the name, not in a hover-only `title`
              // (forgejo#249); the hint below says it for the eye.
              aria-label={`${t("places:gallery.makeCover")}: ${photo.caption ?? t("places:photos.alt")}`}
              style={{
                padding: 0,
                borderRadius: 6,
                border:
                  photo.id === lead.id ? "2px solid var(--accent)" : "1px solid var(--ts-border)",
                cursor: "pointer",
              }}
            >
              <img
                src={photo.url}
                alt={photo.caption ?? t("places:photos.alt")}
                width={56}
                height={56}
                loading="lazy"
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: 5,
                  display: "block",
                }}
              />
            </button>
          ))}
        </div>
      )}
      {photos.length > 1 && <p className="t-caption">{t("places:gallery.makeCoverHint")}</p>}
      {coverFailed && (
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          {t("places:gallery.coverFailed")}
        </p>
      )}
    </section>
  );
}

/** The visits' photos, most recent visit first; undated visits last. */
export function galleryPhotos(place: Place): PlaceVisitPhoto[] {
  const visits = [...(place.visits ?? [])].sort((a, b) => {
    if (a.visitedAt === b.visitedAt) return 0;
    if (a.visitedAt === null) return 1;
    if (b.visitedAt === null) return -1;
    return b.visitedAt.localeCompare(a.visitedAt);
  });
  return visits.flatMap((v) => v.photos ?? []);
}
