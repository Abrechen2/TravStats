import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi } from "../../lib/api/immich";
import { useToastStore } from "../../store/toastStore";

export interface LightboxItem {
  id: string;
  previewUrl: string;
  caption?: string | null;
  /** A local `TripPhoto`, or a live asset proxied from a linked album. */
  source: { kind: "photo" } | { kind: "immich"; linkId: string };
}

interface Props {
  tripId: string;
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
  onCoverChanged?: (coverImageUrl: string) => void;
}

/**
 * Full-screen viewer shared by uploaded photos and linked Immich assets. The
 * only difference between the two is which endpoint sets the cover — the
 * image itself is just a URL, proxied or local.
 */
export default function PhotoLightbox({
  tripId,
  items,
  startIndex,
  onClose,
  onCoverChanged,
}: Props): JSX.Element | null {
  const { t } = useTranslation("immich");
  const addToast = useToastStore((s) => s.addToast);
  const [index, setIndex] = useState(startIndex);
  const [coverSet, setCoverSet] = useState(false);
  const [settingCover, setSettingCover] = useState(false);
  // Tracks which item is on screen *right now*, independent of any closure
  // captured when an in-flight cover request was kicked off. Read only after
  // the request settles, so a stale response can't confirm the wrong photo.
  const currentItemIdRef = useRef<string | null>(null);

  const step = useCallback(
    (delta: number) => {
      setCoverSet(false);
      setIndex((prev) => (prev + delta + items.length) % items.length);
    },
    [items.length]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  if (items.length === 0) return null;
  // Guard against the parent shrinking `items` (e.g. a photo delete) while
  // this lightbox is still open — clamp instead of indexing out of bounds.
  const item = items[Math.min(index, items.length - 1)];
  currentItemIdRef.current = item.id;

  const handleSetCover = async (): Promise<void> => {
    const requestedItemId = item.id;
    setSettingCover(true);
    try {
      const result =
        item.source.kind === "immich"
          ? await immichApi.setImmichCover(tripId, item.source.linkId, item.id)
          : await immichApi.setPhotoCover(tripId, item.id);

      // Only confirm the cover if the user is still looking at the photo
      // the request was actually issued for — otherwise navigating away
      // mid-request would flip the confirmation onto the wrong photo.
      if (currentItemIdRef.current === requestedItemId) {
        setCoverSet(true);
        onCoverChanged?.(result.coverImageUrl);
      }
    } catch {
      addToast("error", t("errors.unreachable"));
    } finally {
      setSettingCover(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="relative max-h-[85vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <img
          data-testid="lightbox-image"
          src={item.previewUrl}
          alt={item.caption ?? ""}
          className="max-h-[85vh] object-contain"
        />

        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label={t("gallery.previous")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t("gallery.next")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
              onClick={() => step(1)}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {item.caption && <span className="text-sm text-slate-300">{item.caption}</span>}
        <button
          type="button"
          className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          onClick={() => void handleSetCover()}
          disabled={settingCover}
        >
          {coverSet ? t("gallery.coverSet") : t("gallery.setAsCover")}
        </button>
        <button
          type="button"
          aria-label={t("gallery.close")}
          className="rounded-sm border border-slate-500 px-3 py-1 text-sm"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
