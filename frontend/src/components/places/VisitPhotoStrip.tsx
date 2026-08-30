import type { JSX } from "react";

import { PhotoStrip } from "../common/PhotoStrip";
import { deleteVisitPhoto, updateVisitPhoto, uploadVisitPhotos } from "../../lib/api/places";
import type { PlaceVisitPhoto } from "../../types/placeList";

interface Props {
  visitId: string;
  photos: PlaceVisitPhoto[];
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
export function VisitPhotoStrip({ visitId, photos }: Props): JSX.Element {
  return (
    <PhotoStrip<PlaceVisitPhoto>
      photos={photos}
      context={`visit:${visitId}`}
      onUpload={(files) => uploadVisitPhotos(visitId, files)}
      onDelete={(photoId) => deleteVisitPhoto(visitId, photoId)}
      onCaption={(photoId, caption) => updateVisitPhoto(visitId, photoId, { caption })}
    />
  );
}
