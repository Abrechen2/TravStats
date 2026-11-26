import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { TripPhoto } from "../../types";
import EnlargeButton from "../common/photoViewer/EnlargeButton";
import { usePhotoViewer } from "../common/photoViewer/usePhotoViewer";

interface Props {
  photos: TripPhoto[];
  /** Edge length in px; the timeline uses small tiles, the full view larger ones. */
  size?: number;
}

/**
 * The photos a journal entry shows, in the author's order (package 9, item 5).
 * Each opens the full picture; nothing here edits — that is the entry form's.
 */
export default function JournalPhotoRow({ photos, size = 64 }: Props): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const viewer = usePhotoViewer();
  if (photos.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {viewer.viewer}
      {photos.map((photo, i) => (
        <EnlargeButton
          key={photo.id}
          onOpen={() =>
            viewer.open(
              photos.map((p) => ({
                id: p.id,
                url: p.url,
                caption: p.caption,
                takenAt: p.takenAt ?? null,
                source: "upload",
              })),
              i
            )
          }
        >
          <img
            src={photo.url}
            alt={photo.caption ?? t("trips:journalModal.photoAlt")}
            width={size}
            height={size}
            loading="lazy"
            style={{
              width: size,
              height: size,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              display: "block",
            }}
          />
        </EnlargeButton>
      ))}
    </div>
  );
}
