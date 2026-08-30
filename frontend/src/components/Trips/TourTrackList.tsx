import { useTranslation } from "../../hooks/useTranslation";
import type { TourTrackMeta } from "../../types/tour";

interface Props {
  tracks: TourTrackMeta[];
  /** Initial list fetch in flight. Mutually exclusive with `loadError`. */
  loading: boolean;
  /** The list fetch failed — DISTINCT from `tracks.length === 0`. A count of
   *  zero next to a failed request is a lie the user cannot see through, so
   *  this never collapses into the empty state. */
  loadError: boolean;
  onRetry: () => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (track: TourTrackMeta) => void;
  pulling: boolean;
  /** Whether a Dawarich connection is configured and usable right now.
   *  Gates the "pull from Dawarich" button the same way `routingAvailable`
   *  gates `TourLegList`'s "routed" option — never offer a control whose
   *  only possible outcome is an error. */
  dawarichAvailable: boolean;
  onPullDawarich: () => void;
}

function formatDistanceKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function formatWindow(startedAt: string, endedAt: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  const start = new Date(startedAt).toLocaleString("de-DE", opts);
  const end = new Date(endedAt).toLocaleString("de-DE", opts);
  return `${start} – ${end}`;
}

/**
 * Recorded tracks for one tour route section (phase 3b, task 8): upload a
 * GPX, pull a window from Dawarich, list what is there with its measured
 * facts, delete one. Fully controlled, no state of its own — the same
 * "caller owns the data, this renders it" shape `TourStopAssigner` and
 * `TourLegList` already follow, so the page is the one place a track list
 * reload and the leg list's coverage gating (`TourLegList`'s `track` option)
 * stay in sync.
 *
 * Three distinct states, never collapsed: `loading` (initial fetch),
 * `loadError` (the fetch failed — NOT the same as an empty list), and the
 * empty list itself (an honest zero, shown only once loading has actually
 * succeeded).
 */
export default function TourTrackList({
  tracks,
  loading,
  loadError,
  onRetry,
  uploading,
  onUpload,
  onDelete,
  pulling,
  dawarichAvailable,
  onPullDawarich,
}: Props): JSX.Element {
  const { t } = useTranslation("trips");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) ${
            uploading ? "opacity-40" : "cursor-pointer"
          }`}
        >
          {uploading ? t("trips:tours.tracks.uploading") : t("trips:tours.tracks.uploadLabel")}
          <input
            type="file"
            accept=".gpx"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              // Clear it, so re-selecting the SAME file after fixing it still fires.
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={pulling || !dawarichAvailable}
          title={dawarichAvailable ? undefined : t("trips:tours.tracks.dawarich.unavailableReason")}
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) disabled:opacity-40"
          onClick={onPullDawarich}
        >
          {pulling
            ? t("trips:tours.tracks.dawarich.pulling")
            : t("trips:tours.tracks.dawarich.pullLabel")}
        </button>
        {!dawarichAvailable && (
          <span className="text-xs text-(--text-muted)">
            {t("trips:tours.tracks.dawarich.unavailableReason")}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-(--text-muted)">{t("trips:tours.tracks.loading")}</p>}

      {!loading && loadError && (
        <div className="text-sm text-rose-400">
          <p>{t("trips:tours.tracks.loadError")}</p>
          <button type="button" className="mt-1 underline text-sm" onClick={onRetry}>
            {t("common:buttons.retry")}
          </button>
        </div>
      )}

      {!loading && !loadError && tracks.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("trips:tours.tracks.empty")}</p>
      )}

      {!loading && !loadError && tracks.length > 0 && (
        <ul className="space-y-2">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--color-border) p-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {formatWindow(track.startedAt, track.endedAt)}
              </span>
              <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
                {t(`trips:tours.tracks.source.${track.source}`)}
              </span>
              {track.truncated && (
                <span
                  className="rounded-sm bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-400"
                  title={t("trips:tours.tracks.truncatedReason")}
                >
                  {t("trips:tours.tracks.truncated")}
                </span>
              )}
              <span className="text-(--text-muted)">
                {t("trips:tours.tracks.pointCount", { count: track.pointCount })}
              </span>
              <span className="text-(--text-muted)">{formatDistanceKm(track.distanceKm)} km</span>
              <button type="button" className="text-xs underline" onClick={() => onDelete(track)}>
                {t("trips:tours.tracks.deleteLabel")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
