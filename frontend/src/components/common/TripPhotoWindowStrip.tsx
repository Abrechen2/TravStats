import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import {
  getTripPhotoWindow,
  type PhotoWindowEntry,
  type WindowPhoto,
} from "../../lib/api/tripPhotoWindows";
import DetailSection from "../ui/DetailSection";
import EnlargeButton from "./photoViewer/EnlargeButton";
import { usePhotoViewer } from "./photoViewer/usePhotoViewer";

interface Props {
  entry: PhotoWindowEntry;
  id: string;
}

/**
 * The trip photos taken during a stay, a flight or a cruise (package 9,
 * item 4). Read-only — no upload, no delete: the photos are the trip's, and
 * this only shows which of them fall into the entry's time and place.
 * Absent when there are none, which is the common case and not worth a box.
 */
export default function TripPhotoWindowStrip({ entry, id }: Props): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const [photos, setPhotos] = useState<WindowPhoto[]>([]);
  const viewer = usePhotoViewer();

  useEffect(() => {
    let cancelled = false;
    getTripPhotoWindow(entry, id)
      .then((rows) => {
        if (!cancelled) setPhotos(rows);
      })
      .catch((err: unknown) => {
        // The page is whole without this strip; the log keeps it traceable.
        logger.warn("TripPhotoWindowStrip: could not load", err);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, id]);

  if (photos.length === 0) return null;
  return (
    <DetailSection title={`${t("trips:photoWindow.title")} · ${photos.length}`}>
      <div className="flex flex-wrap gap-2">
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
                  takenAt: p.takenAt,
                  source: "upload",
                })),
                i
              )
            }
          >
            <img
              src={photo.url}
              alt={photo.caption ?? t("trips:photoWindow.alt")}
              width={72}
              height={72}
              loading="lazy"
              style={{
                width: 72,
                height: 72,
                objectFit: "cover",
                borderRadius: 6,
                border: "1px solid var(--ts-border)",
                display: "block",
              }}
            />
          </EnlargeButton>
        ))}
      </div>
    </DetailSection>
  );
}
