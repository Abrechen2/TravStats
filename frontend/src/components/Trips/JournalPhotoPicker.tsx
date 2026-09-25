import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import type { TripPhoto } from "../../types";

interface Props {
  tripId: string;
  /** Picked photo ids, in the order they were picked. */
  value: string[];
  onChange: (next: string[]) => void;
}

/** A journal entry is a page, not an album — the server's limit too. */
const MAX_PICKS = 12;

/**
 * Pick photos for a journal entry from the trip's own gallery (package 9,
 * item 5). The order of picking is the order they show in. The gallery is
 * read from the server rather than passed in, so the entry form needs nothing
 * from the page it is opened on.
 */
export default function JournalPhotoPicker({ tripId, value, onChange }: Props): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const [gallery, setGallery] = useState<TripPhoto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    tripsApi
      .listPhotos(tripId)
      .then((photos) => {
        if (!cancelled) setGallery(photos);
      })
      .catch((err: unknown) => {
        logger.warn("JournalPhotoPicker: could not load the gallery", err);
        if (!cancelled) setGallery([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (gallery === null) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        …
      </p>
    );
  }
  if (gallery.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("trips:journalModal.photosEmpty")}
      </p>
    );
  }

  const toggle = (id: string): void => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (value.length < MAX_PICKS) onChange([...value, id]);
  };

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={t("trips:journalModal.photosLabel")}
    >
      {gallery.map((photo) => {
        const position = value.indexOf(photo.id);
        const picked = position >= 0;
        return (
          <button
            key={photo.id}
            type="button"
            aria-pressed={picked}
            onClick={() => toggle(photo.id)}
            style={{
              position: "relative",
              padding: 0,
              borderRadius: 6,
              border: picked ? "2px solid var(--accent)" : "1px solid var(--color-border)",
              opacity: picked ? 1 : 0.7,
              cursor: "pointer",
            }}
          >
            <img
              src={photo.url}
              alt={photo.caption ?? t("trips:journalModal.photoAlt")}
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
            {picked && (
              <span
                aria-hidden
                className="absolute top-0.5 left-0.5 rounded px-1 text-[10px] font-semibold"
                style={{ background: "var(--accent)", color: "var(--bg-base)" }}
              >
                {position + 1}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
