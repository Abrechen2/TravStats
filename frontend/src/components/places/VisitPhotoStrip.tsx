import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { deleteVisitPhoto, uploadVisitPhotos } from "../../lib/api/places";
import { useToastStore } from "../../store/toastStore";
import type { PlaceVisitPhoto } from "../../types/placeList";

interface Props {
  visitId: string;
  photos: PlaceVisitPhoto[];
}

/**
 * Photo proof for one visit.
 *
 * Keeps its OWN copy of the list after the first render. The alternative was
 * re-fetching the whole place on every upload, which redraws the map, the
 * visits and the master data to add one thumbnail — and loses the scroll
 * position of the page you are working on.
 *
 * Thumbnails use the server-built `url` verbatim. Rebuilding it from the id
 * here would be a second place that has to know the route, and the one that
 * silently rots when the route moves.
 */
export function VisitPhotoStrip({ visitId, photos }: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PlaceVisitPhoto[]>(photos);
  const [busy, setBusy] = useState(false);

  const handleUpload = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      setBusy(true);
      try {
        const added = await uploadVisitPhotos(visitId, Array.from(files));
        setRows((prev) => [...prev, ...added]);
      } catch (err: unknown) {
        logger.error({ err }, "VisitPhotoStrip: upload failed");
        addToast("error", t("places:photos.uploadFailed"));
      } finally {
        setBusy(false);
        // Clear the input, or picking the same file twice in a row fires no
        // change event and the second upload silently does nothing.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [visitId, addToast, t]
  );

  const handleDelete = useCallback(
    async (photoId: string): Promise<void> => {
      try {
        await deleteVisitPhoto(visitId, photoId);
        setRows((prev) => prev.filter((p) => p.id !== photoId));
      } catch (err: unknown) {
        logger.error({ err }, "VisitPhotoStrip: delete failed");
        addToast("error", t("places:photos.deleteFailed"));
      }
    },
    [visitId, addToast, t]
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {rows.map((photo) => (
        <span key={photo.id} style={{ position: "relative", display: "inline-block" }}>
          <img
            src={photo.url}
            alt={photo.caption ?? t("places:photos.alt")}
            width={64}
            height={64}
            style={{
              width: 64,
              height: 64,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              display: "block",
            }}
          />
          <button
            type="button"
            onClick={() => void handleDelete(photo.id)}
            aria-label={t("places:photos.delete")}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 18,
              height: 18,
              borderRadius: "50%",
              fontSize: 11,
              lineHeight: "16px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </span>
      ))}

      <label
        className="cursor-pointer rounded-md px-3 py-2 text-xs"
        style={{ border: "1px dashed var(--color-border)", color: "var(--text-muted)" }}
      >
        {busy ? t("places:photos.uploading") : `+ ${t("places:photos.add")}`}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={busy}
          onChange={(e) => void handleUpload(e.target.files)}
        />
      </label>
    </div>
  );
}
