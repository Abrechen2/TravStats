import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import type { ImmichAlbumSummary, ImmichMode } from "../../types/immich";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return exponent === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[exponent]}`;
}

// Folds a string for search matching: trims, lower-cases, and strips
// diacritics so a plain-ASCII query (e.g. "munchen") finds "München" — the
// first thing a DE-first user types for an umlaut-bearing album name.
function foldForSearch(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

interface Props {
  tripId: string;
  onClose: () => void;
  onLinked: () => void;
}

interface Selection {
  mode: ImmichMode;
  estimateBytes: number | null;
}

/**
 * Multi-select album picker. Import mode is the expensive choice, so its
 * storage cost is fetched lazily — only for albums the user actually flips to
 * "copy" — and shown before the link is confirmed.
 */
export default function ImmichAlbumPicker({ tripId, onClose, onLinked }: Props): JSX.Element {
  const { t } = useTranslation("immich");

  const [albums, setAlbums] = useState<ImmichAlbumSummary[]>([]);
  const [defaultMode, setDefaultMode] = useState<ImmichMode>("link");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  // Client-side filter only — "selected" stays keyed by album id regardless
  // of what's currently visible, so narrowing the list never drops a
  // selection the user made before changing the query.
  const [query, setQuery] = useState("");
  // Resolved i18n key (e.g. "errors.auth"), not the bare failure kind — so an
  // unrecognised kind resolves to "errors.unknown" via failureKey() at the
  // point of capture rather than being force-fit into "unreachable" here.
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await immichApi.listAlbums(tripId);
        if (cancelled) return;
        setAlbums(data.albums);
        setDefaultMode(data.defaultMode);
      } catch (error) {
        if (!cancelled) setFailure(failureKey(immichFailureKind(error)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // Only "copy" costs disk, so only "copy" pays for an estimate round-trip —
  // whether the album landed in import mode via the user's configured
  // defaultMode or an explicit mode-button click.
  const fetchEstimateIfImport = async (albumId: string, mode: ImmichMode): Promise<void> => {
    if (mode !== "import") return;

    const estimate = await immichApi.estimateImport(tripId, albumId);
    setSelected((prev) =>
      // The album may have been deselected (or switched back to link) while
      // the estimate was in flight — never resurrect it into the selection,
      // and never overwrite a mode the user has since changed away from.
      prev[albumId] && prev[albumId].mode === "import"
        ? { ...prev, [albumId]: { mode: "import", estimateBytes: estimate.totalBytes } }
        : prev
    );
  };

  // Single code path for putting an album into a given mode: write the
  // selection, then lazily fetch the estimate if that mode is "import".
  const selectAlbum = (albumId: string, mode: ImmichMode): void => {
    setSelected((prev) => ({ ...prev, [albumId]: { mode, estimateBytes: null } }));
    void fetchEstimateIfImport(albumId, mode);
  };

  const toggle = (albumId: string): void => {
    const album = albums.find((a) => a.id === albumId);
    if (album?.linked) return; // an already-linked album can never be selected

    if (selected[albumId]) {
      setSelected((prev) => {
        const { [albumId]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    selectAlbum(albumId, defaultMode);
  };

  const setMode = (albumId: string, mode: ImmichMode): void => {
    if (!selected[albumId]) return;
    selectAlbum(albumId, mode);
  };

  const handleConfirm = async (): Promise<void> => {
    setLinking(true);
    try {
      await immichApi.linkAlbums(
        tripId,
        Object.entries(selected).map(([immichAlbumId, s]) => ({ immichAlbumId, mode: s.mode }))
      );
      onLinked();
      onClose();
    } catch (error) {
      setFailure(failureKey(immichFailureKind(error)));
    } finally {
      setLinking(false);
    }
  };

  const count = Object.keys(selected).length;

  const normalizedQuery = foldForSearch(query);
  const filteredAlbums =
    normalizedQuery === ""
      ? albums
      : albums.filter((album) => foldForSearch(album.albumName).includes(normalizedQuery));
  const hasNoMatches = albums.length > 0 && normalizedQuery !== "" && filteredAlbums.length === 0;
  // Selections the current query hides from view — the confirm button's
  // count deliberately still includes these (linking hidden selections is
  // correct), but the user needs a visible reminder they exist.
  const hiddenSelectedCount =
    normalizedQuery === ""
      ? 0
      : Object.keys(selected).filter((id) => !filteredAlbums.some((album) => album.id === id))
          .length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">{t("albums.pickerTitle")}</h2>

        {failure && <p className="text-sm text-rose-400">{t(failure)}</p>}
        {!loading && !failure && albums.length === 0 && (
          <p className="text-sm text-slate-400">{t("albums.empty")}</p>
        )}

        {!loading && albums.length > 0 && (
          <input
            type="text"
            aria-label={t("albums.searchLabel")}
            placeholder={t("albums.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-3 w-full rounded-sm border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
          />
        )}

        {hasNoMatches && <p className="text-sm text-slate-400">{t("albums.noMatches")}</p>}
        {hiddenSelectedCount > 0 && (
          <p className="mb-2 text-xs text-amber-400">
            {t("albums.hiddenSelections", { count: hiddenSelectedCount })}
          </p>
        )}

        <ul className="space-y-2">
          {filteredAlbums.map((album) => {
            const selection = selected[album.id];
            return (
              <li key={album.id} className="rounded-sm border border-slate-700 p-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={album.albumName}
                    disabled={album.linked}
                    checked={Boolean(selection)}
                    onChange={() => toggle(album.id)}
                  />
                  <span className="flex-1">
                    <span className="block">{album.albumName}</span>
                    <span className="block text-xs text-slate-400">
                      {t("albums.photoCount", { count: album.assetCount })}
                    </span>
                  </span>
                  {album.linked && (
                    <span className="text-xs text-slate-500">{t("albums.alreadyLinked")}</span>
                  )}
                </label>

                {selection && (
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    {(["link", "import"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selection.mode === mode}
                        className={`rounded px-2 py-0.5 text-xs ${
                          selection.mode === mode ? "bg-sky-600" : "border border-slate-600"
                        }`}
                        onClick={() => setMode(album.id, mode)}
                      >
                        {mode === "link" ? t("modeLink") : t("modeImport")}
                      </button>
                    ))}
                    {selection.estimateBytes !== null && (
                      <span className="text-xs text-amber-400">
                        {t("albums.estimate", { size: formatBytes(selection.estimateBytes) })}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={linking}
            className="btn-secondary px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            {t("albums.cancel")}
          </button>
          <button
            type="button"
            disabled={count === 0 || linking}
            className="btn-primary px-3 py-1.5 text-sm"
            onClick={() => void handleConfirm()}
          >
            {t("albums.confirm", { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}
