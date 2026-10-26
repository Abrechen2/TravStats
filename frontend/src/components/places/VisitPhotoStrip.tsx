import type { JSX } from "react";

import { PhotoStrip } from "../common/PhotoStrip";
import { deleteVisitPhoto, updateVisitPhoto, uploadVisitPhotos } from "../../lib/api/places";
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
      footer={(merge) => (
        <VisitPhotoSuggestions
          visitId={visitId}
          onLinked={(linked) => {
            merge(linked);
            onChanged?.();
          }}
        />
      )}
    />
  );
}
