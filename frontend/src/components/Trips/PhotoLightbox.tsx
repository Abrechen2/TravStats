import { useCallback, useMemo, useRef, useState } from "react";
import { useCoverCropStore } from "../../store/coverCropStore";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi } from "../../lib/api/immich";
import PhotoViewer from "../common/PhotoViewer";
import { largeUrl, type ViewerPhoto } from "../common/photoViewer/viewerPhoto";
import { reportPageError } from "../../store/pageErrorStore";

export interface LightboxItem {
  id: string;
  previewUrl: string;
  caption?: string | null;
  /** Shown in the caption when the surface knows it (ISO instant). */
  takenAt?: string | null;
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
  const [coverSet, setCoverSet] = useState(false);
  const [settingCover, setSettingCover] = useState(false);
  // Tracks which item is on screen *right now*, independent of any closure
  // captured when an in-flight cover request was kicked off. Read only after
  // the request settles, so a stale response can't confirm the wrong photo.
  const currentItemIdRef = useRef<string | null>(items[startIndex]?.id ?? null);

  const viewerItems = useMemo<ViewerPhoto[]>(
    () =>
      items.map((i) => ({
        id: i.id,
        url: largeUrl(i.previewUrl),
        caption: i.caption,
        takenAt: i.takenAt,
        source: i.source.kind === "immich" ? "immich" : "upload",
      })),
    [items]
  );

  // The cover crop editor opens on top of the viewer and uses the same keys (arrows pan,
  // Escape cancels); while it is open, the viewer must not step or close underneath it.
  const cropEditorOpen = useCoverCropStore((s) => s.request !== null);

  const onStep = useCallback((photo: ViewerPhoto): void => {
    setCoverSet(false);
    currentItemIdRef.current = photo.id;
  }, []);

  const handleSetCover = async (item: LightboxItem): Promise<void> => {
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
        useCoverCropStore.getState().open({
          tripId,
          coverImageUrl: result.coverImageUrl,
          initialCrop: null,
          onDone: () => onCoverChanged?.(result.coverImageUrl),
        });
      }
    } catch {
      reportPageError(t("errors.unreachable"));
    } finally {
      setSettingCover(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <PhotoViewer
      items={viewerItems}
      startIndex={startIndex}
      onClose={onClose}
      onStep={onStep}
      suspendKeys={cropEditorOpen}
      actions={(shown) => {
        const item = items.find((i) => i.id === shown.id);
        if (!item) return null;
        return (
          <button
            type="button"
            className="rounded-sm px-3 py-1 text-sm"
            style={{
              border: "1px solid rgba(255, 255, 255, 0.9)",
              color: "rgba(255, 255, 255, 0.9)",
            }}
            onClick={() => void handleSetCover(item)}
            disabled={settingCover}
          >
            {coverSet ? t("gallery.coverSet") : t("gallery.setAsCover")}
          </button>
        );
      }}
    />
  );
}
