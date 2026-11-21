import type { JSX } from "react";

import { useState } from "react";
import { PhotoStrip } from "../common/PhotoStrip";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import {
  deleteVisitPhoto,
  removeAutoLinkedVisitPhotos,
  updateVisitPhoto,
  uploadVisitPhotos,
} from "../../lib/api/places";
import { useToastStore } from "../../store/toastStore";
import { VisitPhotoSuggestions } from "./VisitPhotoSuggestions";
import type { PlaceVisitPhoto } from "../../types/placeList";

interface Props {
  visitId: string;
  photos: PlaceVisitPhoto[];
  /**
   * After a photo was added, removed, captioned or linked. The strip keeps its
   * own list while it is mounted; the place page re-reads so the row's photo
   * count is right and a strip mounted again later starts from the stored list.
   */
  onChanged?: () => void;
}

/**
 * Photo proof for one visit.
 *
 * The markup and the three operations live in `common/PhotoStrip`; this binds
 * them to the visit endpoints. Lodging photos bind the same component to
 * theirs — the TABLES are separate for a reason that turns on ownership, and
 * this component asks no ownership question, so a second copy of the markup
 * would buy nothing.
 */
export function VisitPhotoStrip({ visitId, photos, onChanged }: Props): JSX.Element {
  const { t } = useTranslation("places");
  const addToast = useToastStore((s) => s.addToast);
  const [removedAuto, setRemovedAuto] = useState(false);
  const autoIds = removedAuto ? [] : photos.filter((p) => p.provenance === "auto").map((p) => p.id);
  const sourceName = (p: PlaceVisitPhoto): string =>
    t(`photos.auto.source.${p.provider ?? "immich"}`);
  const removeAuto = async (drop: (ids: string[]) => void): Promise<void> => {
    try {
      await removeAutoLinkedVisitPhotos(visitId);
      drop(autoIds);
      setRemovedAuto(true);
      onChanged?.();
    } catch (err: unknown) {
      logger.error("VisitPhotoStrip: removing auto links failed", err);
      addToast("error", t("photos.auto.removeFailed"));
    }
  };
  // Each operation reports the change only once it went through: a refused
  // upload changed nothing, and re-reading for it would be noise.
  const changed = async <T,>(op: Promise<T>): Promise<T> => {
    const result = await op;
    onChanged?.();
    return result;
  };
  return (
    <PhotoStrip<PlaceVisitPhoto>
      photos={photos}
      context={`visit:${visitId}`}
      onUpload={(files) => changed(uploadVisitPhotos(visitId, files))}
      onDelete={(photoId) => changed(deleteVisitPhoto(visitId, photoId))}
      onCaption={(photoId, caption) => changed(updateVisitPhoto(visitId, photoId, { caption }))}
      originLabel={(p) =>
        p.provenance === "auto" ? t("photos.auto.label", { source: sourceName(p) }) : null
      }
      footer={(merge, drop) => (
        <>
          {autoIds.length > 0 && (
            <button
              type="button"
              onClick={() => void removeAuto(drop)}
              className="mt-1 self-start text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--text-muted)", background: "none", border: "none", padding: 0 }}
            >
              {t("photos.auto.removeAll")}
            </button>
          )}
          <VisitPhotoSuggestions
            visitId={visitId}
            onLinked={(linked) => {
              merge(linked);
              onChanged?.();
            }}
          />
        </>
      )}
    />
  );
}
