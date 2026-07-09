import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi, immichFailureKind } from "../../lib/api/immich";
import { useToastStore } from "../../store/toastStore";
import type { ImmichFailureKind, ImmichGalleryAsset, LinkedAlbum } from "../../types/immich";
import PhotoLightbox, { type LightboxItem } from "./PhotoLightbox";

const JOB_POLL_MS = 1500;

interface Props {
  tripId: string;
  album: LinkedAlbum;
  onChanged: () => void;
}

/**
 * One gallery section for one linked album.
 *
 * A failing link-mode album degrades to a panel rather than taking the whole
 * gallery down — the user's uploads and their other albums stay visible.
 */
export default function ImmichAlbumSection({ tripId, album, onChanged }: Props): JSX.Element {
  const { t } = useTranslation("immich");
  const addToast = useToastStore((s) => s.addToast);

  const [assets, setAssets] = useState<ImmichGalleryAsset[]>([]);
  const [failure, setFailure] = useState<ImmichFailureKind | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards every async continuation below: a poll tick or a load() that was
  // already in flight when the section unmounts (album swapped, tab closed)
  // must not call setState on a component React has already torn down.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const load = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      const data = await immichApi.getAlbumAssets(tripId, album.id);
      if (!mountedRef.current) return;
      setAssets(data.assets);
    } catch (error) {
      if (!mountedRef.current) return;
      setFailure(immichFailureKind(error) ?? "unreachable");
    }
  }, [tripId, album.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const stopPolling = useCallback((): void => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  // One round-trip against the import job. Runs once immediately when
  // polling starts (so the UI reflects real progress right away instead of
  // waiting a full tick) and again on every subsequent interval.
  const pollOnce = useCallback(async (): Promise<void> => {
    const { job } = await immichApi.getImportJob(tripId, album.id);
    if (!mountedRef.current || !job) return;
    setProgress({ done: job.processedAssets, total: job.totalAssets });
    if (job.status === "completed" || job.status === "failed") {
      stopPolling();
      setSyncing(false);
      setProgress(null);
      await load();
      if (mountedRef.current) onChanged();
    }
  }, [tripId, album.id, stopPolling, load, onChanged]);

  const startPolling = useCallback((): void => {
    setSyncing(true);
    stopPolling();
    void pollOnce();
    pollRef.current = setInterval(() => void pollOnce(), JOB_POLL_MS);
  }, [stopPolling, pollOnce]);

  // Belt-and-suspenders: whatever interval is running must die with the
  // section, even though every code path that starts one also stops it on
  // completion/failure.
  useEffect(() => stopPolling, [stopPolling]);

  const handleResync = async (): Promise<void> => {
    try {
      await immichApi.resyncAlbum(tripId, album.id);
      if (!mountedRef.current) return;
      startPolling();
    } catch (error) {
      if (mountedRef.current)
        addToast("error", t(`errors.${immichFailureKind(error) ?? "unreachable"}`));
    }
  };

  const handleUnlink = async (deleteCopies: boolean): Promise<void> => {
    try {
      await immichApi.unlinkAlbum(tripId, album.id, deleteCopies);
      if (!mountedRef.current) return;
      setConfirmingUnlink(false);
      onChanged();
    } catch (error) {
      if (mountedRef.current)
        addToast("error", t(`errors.${immichFailureKind(error) ?? "unreachable"}`));
    }
  };

  const onUnlinkClick = (): void => {
    // Only import mode has bytes on disk worth asking about.
    if (album.mode === "import") setConfirmingUnlink(true);
    else void handleUnlink(false);
  };

  const items: LightboxItem[] = assets.map((a) => ({
    id: a.id,
    previewUrl: a.previewUrl,
    source: album.mode === "import" ? { kind: "photo" } : { kind: "immich", linkId: album.id },
  }));

  return (
    <section className="mt-6">
      <header className="mb-2 flex items-center gap-3">
        <h3 className="font-semibold">{album.albumName}</h3>
        <span className="text-xs text-slate-400">
          {t("albums.photoCount", { count: album.assetCount })}
        </span>
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">
          {album.mode === "import" ? t("albums.badgeImport") : t("albums.badgeLink")}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {album.mode === "import" && (
            <button
              type="button"
              disabled={syncing}
              className="text-xs underline disabled:opacity-40"
              onClick={() => void handleResync()}
            >
              {syncing && progress
                ? t("albums.resyncing", { done: progress.done, total: progress.total })
                : t("albums.resync")}
            </button>
          )}
          <button type="button" className="text-xs underline" onClick={onUnlinkClick}>
            {t("albums.unlink")}
          </button>
        </div>
      </header>

      {confirmingUnlink && (
        <div className="mb-2 flex gap-2 rounded border border-slate-600 p-2 text-sm">
          <span className="flex-1">{t("albums.unlinkTitle")}</span>
          <button type="button" className="underline" onClick={() => void handleUnlink(false)}>
            {t("albums.unlinkKeepCopies")}
          </button>
          <button
            type="button"
            className="text-rose-400 underline"
            onClick={() => void handleUnlink(true)}
          >
            {t("albums.unlinkDeleteCopies")}
          </button>
        </div>
      )}

      {failure ? (
        <div className="rounded border border-slate-700 bg-slate-900/60 p-4 text-sm">
          <p className="text-rose-400">{t(`errors.${failure}`)}</p>
          {failure !== "notFound" && (
            <button type="button" className="mt-2 underline" onClick={() => void load()}>
              {t("errors.retry")}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {assets.map((asset, index) => (
            <button key={asset.id} type="button" onClick={() => setLightboxIndex(index)}>
              <img
                src={asset.url}
                alt={album.albumName}
                loading="lazy"
                className="aspect-square w-full rounded object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          tripId={tripId}
          items={items}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onCoverChanged={() => onChanged()}
        />
      )}
    </section>
  );
}
