import { useRef, useState } from "react";
import type { LinkedAlbum } from "../../types/immich";
import type { TripPhoto } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import PhotoLightbox, { type LightboxItem } from "./PhotoLightbox";
import ImmichAlbumPicker from "./ImmichAlbumPicker";
import ImmichAlbumSection from "./ImmichAlbumSection";

interface TripGalleryProps {
  tripId: string;
  photos: TripPhoto[];
  immichAlbums: LinkedAlbum[];
  onChange: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Gallery tab content (Phase-1 iteration 7). Multi-image upload, grid
 * preview, click-to-enlarge lightbox, hover delete + caption edit — plus
 * one section per linked Immich album (Phase-A Immich integration).
 */
export default function TripGallery({
  tripId,
  photos,
  immichAlbums,
  onChange,
}: TripGalleryProps): JSX.Element {
  const { t } = useTranslation(["trips", "common", "immich"]);
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const uploadedItems: LightboxItem[] = photos.map((p) => ({
    id: p.id,
    previewUrl: p.url,
    caption: p.caption,
    source: { kind: "photo" },
  }));

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-uploading the same file
    if (files.length === 0) return;
    setUploading(true);
    try {
      await tripsApi.uploadPhotos(tripId, files);
      addToast(
        "success",
        t("trips:gallery.uploaded", {
          count: files.length,
          defaultValue: "{{count}} Foto hochgeladen",
        })
      );
      onChange();
    } catch {
      addToast("error", t("trips:gallery.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (photo: TripPhoto): Promise<void> => {
    if (!window.confirm(t("trips:gallery.deleteConfirm"))) return;
    try {
      await tripsApi.deletePhoto(tripId, photo.id);
      onChange();
    } catch {
      addToast("error", t("trips:gallery.deleteError"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("trips:gallery.title")}
        </h3>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void handleFileSelect(e)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {uploading ? t("common:loading.default") : t("trips:gallery.uploadButton")}
          </button>
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="px-3 py-1.5 rounded-md text-xs font-medium border"
            style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
          >
            {t("immich:albums.link")}
          </button>
        </div>
      </div>

      {(photos.length > 0 || immichAlbums.length === 0) && (
        <section>
          <h4
            className="text-sm font-semibold mb-2"
            style={{ color: "var(--text-secondary, var(--text-primary))" }}
          >
            {t("immich:gallery.uploaded")}{" "}
            <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
              · {photos.length}
            </span>
          </h4>

          {photos.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center text-sm"
              style={{
                background: "var(--bg-elevated)",
                border: "1px dashed var(--color-border)",
                color: "var(--text-muted)",
              }}
            >
              {t("trips:gallery.empty")}
            </div>
          ) : (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((p, i) => (
                <PhotoTile
                  key={p.id}
                  photo={p}
                  onClick={() => setLightbox({ index: i })}
                  onDelete={() => void handleDelete(p)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {immichAlbums.map((album) => (
        <ImmichAlbumSection key={album.id} tripId={tripId} album={album} onChanged={onChange} />
      ))}

      {lightbox && (
        <PhotoLightbox
          tripId={tripId}
          items={uploadedItems}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onCoverChanged={() => onChange()}
        />
      )}

      {showPicker && (
        <ImmichAlbumPicker
          tripId={tripId}
          onClose={() => setShowPicker(false)}
          onLinked={() => onChange()}
        />
      )}
    </div>
  );
}

interface PhotoTileProps {
  photo: TripPhoto;
  onClick: () => void;
  onDelete: () => void;
}

function PhotoTile({ photo, onClick, onDelete }: PhotoTileProps): JSX.Element {
  return (
    <div
      className="relative group rounded-lg overflow-hidden aspect-square cursor-pointer"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
      onClick={onClick}
    >
      <img
        src={photo.url}
        alt={photo.caption ?? ""}
        loading="lazy"
        className="w-full h-full object-cover transition-transform group-hover:scale-105"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: "rgba(13,17,23,0.8)",
          color: "#f87171",
          backdropFilter: "blur(4px)",
        }}
        aria-label="Delete"
      >
        ✕
      </button>
      {photo.caption && (
        <div
          className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px] truncate"
          style={{
            background: "linear-gradient(transparent, rgba(13,17,23,0.85))",
            color: "#fff",
          }}
        >
          {photo.caption}
        </div>
      )}
    </div>
  );
}
