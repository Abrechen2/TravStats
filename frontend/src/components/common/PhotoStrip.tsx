import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";

/** The shape every photo endpoint answers with. */
export interface StripPhoto {
  id: string;
  url: string;
  caption: string | null;
}

interface Props<T extends StripPhoto> {
  photos: T[];
  /** What the three operations do. The strip knows no endpoint. */
  onUpload: (files: File[]) => Promise<T[]>;
  onDelete: (photoId: string) => Promise<void>;
  onCaption: (photoId: string, caption: string | null) => Promise<T>;
  /** For the log line, so a failure can be traced to a call site. */
  context: string;
}

/**
 * A row of thumbnails with upload, delete and captioning.
 *
 * Generic over the photo type because visits and lodgings both have one and the
 * differences are all server-side. The TABLES are deliberately separate — the
 * reason is written out in `routes/places/visitPhotos.ts` and turns on the
 * ownership question — but this component asks no ownership question at all, so
 * a second copy of two hundred lines of markup would buy nothing.
 *
 * Keeps its OWN copy of the list after the first render. The alternative was
 * re-fetching the whole record on every upload, which redraws everything around
 * it to add one thumbnail — and loses the scroll position of the page you are
 * working on.
 *
 * Thumbnails use the server-built `url` verbatim. Rebuilding it from the id
 * here would be a second place that has to know the route, and the one that
 * silently rots when the route moves.
 */
export function PhotoStrip<T extends StripPhoto>({
  photos,
  onUpload,
  onDelete,
  onCaption,
  context,
}: Props<T>): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<T[]>(photos);
  const [busy, setBusy] = useState(false);
  /** Photo currently being captioned, and the text as typed so far. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const handleUpload = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      setBusy(true);
      try {
        const added = await onUpload(Array.from(files));
        setRows((prev) => [...prev, ...added]);
      } catch (err: unknown) {
        logger.error({ err, context }, "PhotoStrip: upload failed");
        addToast("error", t("places:photos.uploadFailed"));
      } finally {
        setBusy(false);
        // Clear the input, or picking the same file twice in a row fires no
        // change event and the second upload silently does nothing.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onUpload, context, addToast, t]
  );

  const handleDelete = useCallback(
    async (photoId: string): Promise<void> => {
      try {
        await onDelete(photoId);
        setRows((prev) => prev.filter((p) => p.id !== photoId));
      } catch (err: unknown) {
        logger.error({ err, context }, "PhotoStrip: delete failed");
        addToast("error", t("places:photos.deleteFailed"));
      }
    },
    [onDelete, context, addToast, t]
  );

  /**
   * Save a caption. `PATCH …/photos/:id` accepted one from the day the route
   * was built and nothing ever sent one — the caption was readable as an
   * image's alt text and not typeable anywhere.
   *
   * An empty box CLEARS the caption rather than storing "": a photo with no
   * caption and a photo captioned with nothing are the same thing, and only
   * one of them should end up in the database.
   */
  const handleCaption = useCallback(
    async (photoId: string, text: string): Promise<void> => {
      const caption = text.trim() === "" ? null : text.trim();
      setEditing(null);
      const current = rows.find((p) => p.id === photoId);
      if (current && (current.caption ?? null) === caption) return;
      try {
        const saved = await onCaption(photoId, caption);
        setRows((prev) => prev.map((p) => (p.id === photoId ? saved : p)));
      } catch (err: unknown) {
        logger.error({ err, context }, "PhotoStrip: caption failed");
        addToast("error", t("places:photos.captionFailed"));
      }
    },
    [onCaption, context, rows, addToast, t]
  );

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {rows.map((photo) => (
        <span
          key={photo.id}
          style={{ display: "inline-flex", flexDirection: "column", gap: 2, width: 64 }}
        >
          <span style={{ position: "relative", display: "inline-block" }}>
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

          {editing?.id === photo.id ? (
            <input
              autoFocus
              value={editing.text}
              aria-label={t("places:photos.caption")}
              onChange={(e) => setEditing({ id: photo.id, text: e.target.value })}
              onBlur={() => void handleCaption(photo.id, editing.text)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCaption(photo.id, editing.text);
                if (e.key === "Escape") setEditing(null);
              }}
              className="w-full rounded px-1 text-[10px]"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing({ id: photo.id, text: photo.caption ?? "" })}
              className="w-full truncate text-left text-[10px]"
              style={{
                color: photo.caption
                  ? "var(--text-muted)"
                  : "var(--text-subtle, var(--text-muted))",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                opacity: photo.caption ? 1 : 0.6,
              }}
              title={photo.caption ?? t("places:photos.captionAdd")}
            >
              {photo.caption ?? t("places:photos.captionAdd")}
            </button>
          )}
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
