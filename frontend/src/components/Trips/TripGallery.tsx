import { useRef, useState } from "react";
import type { TripPhoto } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface TripGalleryProps {
  tripId: string;
  photos: TripPhoto[];
  onChange: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Gallery tab content (Phase-1 iteration 7). Multi-image upload, grid
 * preview, click-to-enlarge lightbox, hover delete + caption edit.
 */
export default function TripGallery({ tripId, photos, onChange }: TripGalleryProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<TripPhoto | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-uploading the same file
    if (files.length === 0) return;
    setUploading(true);
    try {
      await tripsApi.uploadPhotos(tripId, files);
      addToast(
        "success",
        t("trips:gallery.uploaded", { count: files.length, defaultValue: "{{count}} Foto hochgeladen" }),
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
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("trips:gallery.title")}{" "}
          <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
            · {photos.length}
          </span>
        </h3>
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
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-50"
        >
          {uploading ? t("common:loading") : t("trips:gallery.uploadButton")}
        </button>
      </div>

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
          {photos.map((p) => (
            <PhotoTile
              key={p.id}
              photo={p}
              onClick={() => setLightbox(p)}
              onDelete={() => void handleDelete(p)}
            />
          ))}
        </div>
      )}

      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}
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

interface LightboxProps {
  photo: TripPhoto;
  onClose: () => void;
}

function Lightbox({ photo, onClose }: LightboxProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <img
        src={photo.url}
        alt={photo.caption ?? ""}
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full text-white text-lg"
        style={{ background: "rgba(255,255,255,0.1)" }}
        aria-label="Close"
      >
        ✕
      </button>
      {photo.caption && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm max-w-[80%]"
          style={{ background: "rgba(13,17,23,0.85)", color: "#fff" }}
        >
          {photo.caption}
        </div>
      )}
    </div>
  );
}
