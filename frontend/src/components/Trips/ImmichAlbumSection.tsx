import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import type {
  AlbumDays,
  ImmichGalleryAsset,
  ImportJob,
  LinkedAlbum,
  PhotoSourceKind,
} from "../../types/immich";
import OverflowMenu from "../ui/OverflowMenu";
import PhotoLightbox, { type LightboxItem } from "./PhotoLightbox";
import AlbumDayPhotos from "./AlbumDayPhotos";
import GalleryDayStrip, { ALL_DAYS, dayKey } from "./GalleryDayStrip";
import { useDayPrefetch } from "./useDayPrefetch";
import { reportPageError } from "../../store/pageErrorStore";

const JOB_POLL_MS = 1500;
/** Consecutive failed job polls after which polling stops and the failure is shown. */
const MAX_POLL_FAILURES = 3;

/** Viewing preference, not instance state — it belongs in the browser. */
const GROUP_PREF_KEY = "travstats.gallery.groupByDay";

/** Last day opened, per trip — the next visit starts where this one stopped. */
const lastDayKey = (tripId: string): string => `travstats.gallery.lastDay.${tripId}`;

function readLastDay(tripId: string): string | null {
  try {
    return localStorage.getItem(lastDayKey(tripId));
  } catch {
    return null;
  }
}

function readGroupPref(): boolean {
  try {
    return localStorage.getItem(GROUP_PREF_KEY) !== "false";
  } catch {
    // Private mode / blocked storage must not take the gallery down.
    return true;
  }
}

/**
 * The sentence a finished import run deserves, or null for a clean run. The
 * job's `error` is a failure kind from the fixed Immich vocabulary; anything
 * else (a disk/database failure, or a row written before kinds were stored)
 * gets a neutral "unknown" reason rather than a guessed one.
 */
function describeImportOutcome(
  job: ImportJob,
  provider: PhotoSourceKind,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (job.status === "failed") {
    // The source's own words: "PhotoPrism rejected the app password", not Immich's.
    const key = failureKey(job.error, provider);
    const reason = t(key === "errors.unknown" ? "albums.importFailedUnknown" : key);
    return t("albums.importFailed", { reason });
  }
  // Completed, but the album was longer than one run reads (`truncated:<N>`).
  const truncated = /^truncated:(\d+)$/.exec(job.error ?? "");
  if (job.status === "completed" && truncated) {
    return t("albums.importTruncated", { count: Number(truncated[1]) });
  }
  if (job.failedAssets > 0) {
    return t("albums.importPartial", { failed: job.failedAssets, total: job.totalAssets });
  }
  return null;
}

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

  const [days, setDays] = useState<AlbumDays | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Bumped when the album's content changed under the open day (a re-sync).
  const [reloadToken, setReloadToken] = useState(0);
  // Resolved i18n key (e.g. "errors.auth"), not the bare failure kind — so an
  // unrecognised kind resolves to "errors.unknown" via failureKey() at the
  // point of capture rather than being force-fit into "unreachable" here.
  const [failure, setFailure] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [groupByDayEnabled, setGroupByDayEnabled] = useState<boolean>(readGroupPref);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // How the last import run ended, when that is worth saying: it failed, or
  // some photos did not come across. It used to end silently — the button
  // simply became clickable again, whatever had happened.
  const [importOutcome, setImportOutcome] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailuresRef = useRef(0);
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
      const data = await immichApi.getAlbumDays(tripId, album.id);
      if (!mountedRef.current) return;
      setDays(data);
      setReloadToken((n) => n + 1);
    } catch (error) {
      if (!mountedRef.current) return;
      logger.warn("Linked album failed to load", {
        provider: album.provider,
        kind: immichFailureKind(error),
      });
      setFailure(failureKey(immichFailureKind(error), album.provider));
    }
  }, [tripId, album.id, album.provider]);

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
    let job: Awaited<ReturnType<typeof immichApi.getImportJob>>["job"];
    try {
      ({ job } = await immichApi.getImportJob(tripId, album.id));
      pollFailuresRef.current = 0;
    } catch (error) {
      if (!mountedRef.current) return;
      // A single dropped poll is tolerated; a run of them means the progress
      // will never arrive, so stop and say why instead of spinning forever
      // (forgejo#375).
      pollFailuresRef.current += 1;
      if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
        stopPolling();
        setSyncing(false);
        setProgress(null);
        setFailure(failureKey(immichFailureKind(error), album.provider));
      }
      return;
    }
    if (!mountedRef.current || !job) return;
    setProgress({ done: job.processedAssets, total: job.totalAssets });
    if (job.status === "completed" || job.status === "failed") {
      stopPolling();
      setSyncing(false);
      setProgress(null);
      setImportOutcome(describeImportOutcome(job, album.provider, t));
      await load();
      if (mountedRef.current) onChanged();
    }
  }, [tripId, album.id, album.provider, stopPolling, load, onChanged, t]);

  const startPolling = useCallback((): void => {
    setSyncing(true);
    stopPolling();
    pollFailuresRef.current = 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling/stopPolling are intentionally omitted (see above)
  }, [tripId, album.id, album.mode]);

  const handleResync = async (): Promise<void> => {
    setImportOutcome(null);
    try {
      await immichApi.resyncAlbum(tripId, album.id);
      if (!mountedRef.current) return;
      startPolling();
    } catch (error) {
      if (mountedRef.current)
        reportPageError(t(failureKey(immichFailureKind(error), album.provider)));
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
        reportPageError(t(failureKey(immichFailureKind(error), album.provider)));
    }
  };

  const onUnlinkClick = (): void => {
    // Only import mode has bytes on disk worth asking about.
    if (album.mode === "import") setConfirmingUnlink(true);
    else void handleUnlink(false);
  };

  const hasDates = (days?.days ?? []).some((d) => d.day !== null);
  const showGroups = groupByDayEnabled && hasDates;

  // Which day is open: the user's choice, else the day they last opened on this
  // trip when this album has photos on it, else the first day with photos.
  const bucketKeys = (days?.days ?? []).map(dayKey);
  const remembered = readLastDay(tripId);
  const openDay = !showGroups
    ? ALL_DAYS
    : selectedDay && (selectedDay === ALL_DAYS || bucketKeys.includes(selectedDay))
      ? selectedDay
      : remembered && (remembered === ALL_DAYS || bucketKeys.includes(remembered))
        ? remembered
        : (bucketKeys[0] ?? ALL_DAYS);

  const chooseDay = (key: string): void => {
    setSelectedDay(key);
    try {
      localStorage.setItem(lastDayKey(tripId), key);
    } catch {
      // Remembering the day is a convenience; the view works without it.
    }
  };

  const openLightbox = (shown: ImmichGalleryAsset[], index: number): void =>
    setLightbox({
      items: shown.map((a) => ({
        id: a.id,
        previewUrl: a.previewUrl,
        source: album.mode === "import" ? { kind: "photo" } : { kind: "immich", linkId: album.id },
      })),
      index,
    });

  useDayPrefetch({
    tripId,
    linkId: album.id,
    keys: showGroups ? bucketKeys : [],
    current: openDay,
    enabled: !failure,
  });

  return (
    <section className="mt-6">
      <header className="mb-2 flex items-center gap-3">
        <h3 className="font-semibold">{album.albumName}</h3>
        {album.assetCount !== null && (
          <span className="text-xs text-slate-400">
            {t("albums.photoCount", { count: album.assetCount })}
          </span>
        )}
        <span
          data-testid="album-source"
          className="rounded-sm border border-slate-600 px-1.5 py-0.5 text-xs"
        >
          {album.provider === "photoprism" ? t("albums.badgePhotoprism") : t("albums.badgeImmich")}
        </span>
        <span className="rounded-sm bg-slate-700 px-1.5 py-0.5 text-xs">
          {album.mode === "import" ? t("albums.badgeImport") : t("albums.badgeLink")}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {hasDates && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>{t("albums.groupByDay")}</span>
              {/* Same switch pattern as the active-domains setting — a text
                  link read as navigation and never showed whether grouping
                  was on. */}
              <button
                type="button"
                role="switch"
                aria-checked={showGroups}
                aria-label={t("albums.groupByDay")}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                  showGroups ? "bg-(--accent)" : "bg-gray-600"
                }`}
                onClick={() => {
                  const next = !groupByDayEnabled;
                  setGroupByDayEnabled(next);
                  try {
                    localStorage.setItem(GROUP_PREF_KEY, String(next));
                  } catch {
                    // A rejected write only costs the preference, not the view.
                  }
                }}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    showGroups ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </label>
          )}
          {/* Re-sync and unlink are the album's rare actions: one card ⋯, unlink last and red
              (owner, 2026-11-22). The day grouping stays, it is a view switch. */}
          {syncing && progress && (
            <span role="status" className="text-xs text-slate-400">
              {t("albums.resyncing", { done: progress.done, total: progress.total })}
            </span>
          )}
          <OverflowMenu
            label={t("albums.menuLabel", { name: album.albumName })}
            testId="album-menu"
            entries={[
              ...(album.mode === "import"
                ? [
                    {
                      key: "resync",
                      testId: "album-resync",
                      label: t("albums.resync"),
                      disabled: syncing,
                      onSelect: () => void handleResync(),
                    },
                  ]
                : []),
              {
                key: "unlink",
                testId: "album-unlink",
                label: t("albums.unlink"),
                danger: true,
                onSelect: onUnlinkClick,
              },
            ]}
          />
        </div>
      </header>

      {importOutcome !== null && (
        <p role="alert" className="mb-2 rounded-sm border border-amber-500/40 p-2 text-sm">
          {importOutcome}
        </p>
      )}

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

      {days?.truncated && !failure && (
        <p role="status" data-testid="album-truncated" className="mb-2 text-xs text-slate-400">
          {t(album.provider === "photoprism" ? "albums.truncatedPhotoprism" : "albums.truncated", {
            shown: days?.total ?? 0,
          })}
        </p>
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
      ) : days ? (
        <>
          {showGroups && (
            <GalleryDayStrip
              days={days.days}
              total={days.total}
              selected={openDay}
              onSelect={chooseDay}
            />
          )}
          <AlbumDayPhotos
            // A new day is a new list: keyed so no page of the old one lingers.
            key={openDay}
            tripId={tripId}
            linkId={album.id}
            provider={album.provider}
            albumName={album.albumName}
            day={openDay}
            zone={days.zone}
            headers={showGroups && openDay === ALL_DAYS}
            reloadToken={reloadToken}
            onOpen={openLightbox}
          />
        </>
      ) : null}

      {lightbox !== null && (
        <PhotoLightbox
          tripId={tripId}
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onCoverChanged={() => onChanged()}
        />
      )}
    </section>
  );
}
