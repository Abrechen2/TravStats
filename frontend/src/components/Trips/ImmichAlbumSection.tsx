import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import { useToastStore } from "../../store/toastStore";
import type { ImmichGalleryAsset, LinkedAlbum } from "../../types/immich";
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
  // Resolved i18n key (e.g. "errors.auth"), not the bare failure kind — so an
  // unrecognised kind resolves to "errors.unknown" via failureKey() at the
  // point of capture rather than being force-fit into "unreachable" here.
  const [failure, setFailure] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards every async continuation below: a poll tick or a load() that was
  // already in flight when the section unmounts (album swapped, tab closed)
  // must not call setState on a component React has already torn down.
  const mountedRef = useRef(true);
  useEffect(() => {
    // Reset on every setup, not just false-on-cleanup: under <StrictMode>
    // (main.tsx) dev mounts run setup -> cleanup -> setup, so without this the
    // ref would stay false for the component's whole life and every guarded
    // continuation below would silently bail (empty grid, no error).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      const data = await immichApi.getAlbumAssets(tripId, album.id);
      if (!mountedRef.current) return;
      setAssets(data.assets);
    } catch (error) {
      if (!mountedRef.current) return;
      setFailure(failureKey(immichFailureKind(error)));
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

  // Resume live progress if an import is already running when this section
  // mounts — the user reloaded mid-sync, or landed on the gallery right after
  // linking an import album. The backend keeps the job row non-terminal only
  // while a run is genuinely active (the /resync handler resets a stale
  // terminal row to `pending` before it answers), so a `completed`/`failed`
  // read here means the previous run really finished and the UI stays idle.
  // A missing row (first-ever link, no job yet) is treated the same as
  // terminal: nothing to resume.
  useEffect(() => {
    if (album.mode !== "import") return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { job } = await immichApi.getImportJob(tripId, album.id);
        if (cancelled || !mountedRef.current || !job) return;
        if (job.status === "pending" || job.status === "running") {
          setProgress({ done: job.processedAssets, total: job.totalAssets });
          startPolling();
        }
      } catch {
        // A failed status probe is non-fatal: the assets still render and the
        // user can trigger a manual re-sync.
      }
    })();
    return () => {
      cancelled = true;
      // If this probe started a poller, stop it before the effect re-runs (a
      // mode change) or the section unmounts — otherwise a leaked interval keeps
      // ticking. Idempotent and safe when no interval is running.
      stopPolling();
    };
    // `startPolling` is intentionally omitted: it closes over stable refs and
    // callbacks, and re-running this probe on its identity change would
    // needlessly re-fire getImportJob. The probe is a mount-time concern keyed
    // only on which album this section renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, album.id, album.mode]);

  const handleResync = async (): Promise<void> => {
    try {
      await immichApi.resyncAlbum(tripId, album.id);
      if (!mountedRef.current) return;
      startPolling();
    } catch (error) {
      if (mountedRef.current) addToast("error", t(failureKey(immichFailureKind(error))));
    }
  };

  const handleUnlink = async (deleteCopies: boolean): Promise<void> => {
    try {
      await immichApi.unlinkAlbum(tripId, album.id, deleteCopies);
      if (!mountedRef.current) return;
      setConfirmingUnlink(false);
      onChanged();
    } catch (error) {
      if (mountedRef.current) addToast("error", t(failureKey(immichFailureKind(error))));
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
        <span className="rounded-sm bg-slate-700 px-1.5 py-0.5 text-xs">
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
        <div className="mb-2 flex gap-2 rounded-sm border border-slate-600 p-2 text-sm">
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
        <div className="rounded-sm border border-slate-700 bg-slate-900/60 p-4 text-sm">
          <p className="text-rose-400">{t(failure)}</p>
          {failure !== "errors.notFound" && (
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
                className="aspect-square w-full rounded-sm object-cover"
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
