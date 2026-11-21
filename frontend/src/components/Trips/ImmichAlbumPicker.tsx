import Modal from "../Modal";
import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import { formatBytes } from "../../lib/fileSize";
import { logger } from "../../lib/logger";
import type { ImmichAlbumSummary, ImmichMode, PhotoSourceKind } from "../../types/immich";

const SOURCES: readonly PhotoSourceKind[] = ["immich", "photoprism"];

/** What one photo source answered when the picker opened. */
type SourceState =
  | { status: "loading" }
  | { status: "notConfigured" }
  | { status: "failed"; failure: string }
  | { status: "ok"; albums: ImmichAlbumSummary[] };

const selectionKey = (provider: PhotoSourceKind, albumId: string): string =>
  JSON.stringify([provider, albumId]);

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
  provider: PhotoSourceKind;
  albumId: string;
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

  const [sources, setSources] = useState<Record<PhotoSourceKind, SourceState>>({
    immich: { status: "loading" },
    photoprism: { status: "loading" },
  });
  const [source, setSource] = useState<PhotoSourceKind | null>(null);
  const [defaultMode, setDefaultMode] = useState<ImmichMode>("link");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  // Client-side filter only — "selected" stays keyed by album id regardless
  // of what's currently visible, so narrowing the list never drops a
  // selection the user made before changing the query.
  const [query, setQuery] = useState("");
  // Resolved i18n key (e.g. "errors.auth"), not the bare failure kind — so an
  // unrecognised kind resolves to "errors.unknown" via failureKey() at the
  // point of capture rather than being force-fit into "unreachable" here.
  const [linkFailure, setLinkFailure] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // Both sources are asked at once: a source that answers `notConfigured` is
  // not connected, and the switch exists only when both are.
  useEffect(() => {
    let cancelled = false;
    const load = async (provider: PhotoSourceKind): Promise<void> => {
      let next: SourceState;
      try {
        const data = await immichApi.listAlbums(tripId, provider);
        if (provider === "immich") setDefaultMode(data.defaultMode);
        next = { status: "ok", albums: data.albums };
      } catch (error) {
        const kind = immichFailureKind(error);
        if (kind === "notConfigured") {
          next = { status: "notConfigured" };
        } else {
          logger.warn("Album list failed", { provider, kind });
          next = { status: "failed", failure: failureKey(kind, provider) };
        }
      }
      if (!cancelled) setSources((prev) => ({ ...prev, [provider]: next }));
    };
    void Promise.all(SOURCES.map(load));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const connected = SOURCES.filter((p) => sources[p].status !== "notConfigured");
  const loading = SOURCES.some((p) => sources[p].status === "loading");
  const showSwitch = !loading && connected.length === SOURCES.length;
  // Immich first (it was the only source for a long time), else the one that is connected.
  const active: PhotoSourceKind = source ?? connected[0] ?? "immich";
  const activeState = sources[active];
  const albums = activeState.status === "ok" ? activeState.albums : [];
  const failure =
    linkFailure ??
    (activeState.status === "failed"
      ? activeState.failure
      : !loading && connected.length === 0
        ? failureKey("notConfigured")
        : null);

  // Only "copy" costs disk, so only "copy" pays for an estimate round-trip —
  // whether the album landed in import mode via the user's configured
  // defaultMode or an explicit mode-button click.
  const fetchEstimateIfImport = async (
    key: string,
    provider: PhotoSourceKind,
    albumId: string,
    mode: ImmichMode
  ): Promise<void> => {
    if (mode !== "import") return;

    const estimate = await immichApi.estimateImport(tripId, albumId, provider);
    setSelected((prev) =>
      // The album may have been deselected (or switched back to link) while
      // the estimate was in flight — never resurrect it into the selection,
      // and never overwrite a mode the user has since changed away from.
      prev[key] && prev[key].mode === "import"
        ? { ...prev, [key]: { ...prev[key], estimateBytes: estimate.totalBytes } }
        : prev
    );
  };

  // Single code path for putting an album into a given mode: write the
  // selection, then lazily fetch the estimate if that mode is "import".
  const selectAlbum = (provider: PhotoSourceKind, albumId: string, mode: ImmichMode): void => {
    const key = selectionKey(provider, albumId);
    setSelected((prev) => ({ ...prev, [key]: { provider, albumId, mode, estimateBytes: null } }));
    void fetchEstimateIfImport(key, provider, albumId, mode).catch((error: unknown) => {
      logger.warn("Import estimate failed", { provider, kind: immichFailureKind(error) });
      setLinkFailure(failureKey(immichFailureKind(error), provider));
    });
  };

  const toggle = (albumId: string): void => {
    const album = albums.find((a) => a.id === albumId);
    if (album?.linked) return; // an already-linked album can never be selected

    const key = selectionKey(active, albumId);
    if (selected[key]) {
      setSelected((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    selectAlbum(active, albumId, defaultMode);
  };

  const setMode = (albumId: string, mode: ImmichMode): void => {
    if (!selected[selectionKey(active, albumId)]) return;
    selectAlbum(active, albumId, mode);
  };

  const handleConfirm = async (): Promise<void> => {
    setLinking(true);
    setLinkFailure(null);
    // One request links into one source, so each source's albums go separately.
    const chosen = Object.values(selected);
    let linkedAny = false;
    try {
      for (const provider of SOURCES) {
        const ofSource = chosen.filter((c) => c.provider === provider);
        if (ofSource.length === 0) continue;
        try {
          await immichApi.linkAlbums(
            tripId,
            ofSource.map((c) => ({ immichAlbumId: c.albumId, mode: c.mode, provider }))
          );
          linkedAny = true;
          // What was linked leaves the selection, so a retry cannot link it twice.
          setSelected((prev) =>
            Object.fromEntries(Object.entries(prev).filter(([, v]) => v.provider !== provider))
          );
        } catch (error) {
          logger.warn("Linking albums failed", { provider, kind: immichFailureKind(error) });
          setLinkFailure(failureKey(immichFailureKind(error), provider));
          if (linkedAny) onLinked();
          return;
        }
      }
      onLinked();
      onClose();
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
      : Object.values(selected).filter(
          (sel) =>
            sel.provider !== active || !filteredAlbums.some((album) => album.id === sel.albumId)
        ).length;

  return (
    <Modal
      open
      onClose={onClose}
      busy={linking}
      title={t("albums.pickerTitle")}
      maxWidth={512}
      closeLabel={t("albums.cancel")}
      footer={
        <>
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
        </>
      }
    >
      <>
        {showSwitch && (
          <div role="group" aria-label={t("albums.sourceLabel")} className="mb-3 flex gap-2">
            {SOURCES.map((provider) => (
              <button
                key={provider}
                type="button"
                aria-pressed={active === provider}
                className="rounded px-2 py-0.5 text-xs"
                style={
                  active === provider
                    ? { background: "var(--ts-info)", color: "var(--ts-bg)" }
                    : { border: "1px solid var(--ts-border)" }
                }
                onClick={() => {
                  setSource(provider);
                  setQuery("");
                  setLinkFailure(null);
                }}
              >
                {provider === "photoprism" ? t("albums.badgePhotoprism") : t("albums.badgeImmich")}
              </button>
            ))}
          </div>
        )}
        {failure && (
          <p className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {t(failure)}
          </p>
        )}
        {!loading && !failure && albums.length === 0 && (
          <p className="text-sm" style={{ color: "var(--ts-muted)" }}>
            {t("albums.empty")}
          </p>
        )}

        {!loading && albums.length > 0 && (
          <input
            type="text"
            aria-label={t("albums.searchLabel")}
            placeholder={t("albums.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-3 w-full rounded-sm px-2 py-1.5 text-sm"
            style={{
              border: "1px solid var(--ts-border)",
              background: "var(--ts-surface2)",
            }}
          />
        )}

        {hasNoMatches && (
          <p className="text-sm" style={{ color: "var(--ts-muted)" }}>
            {t("albums.noMatches")}
          </p>
        )}
        {hiddenSelectedCount > 0 && (
          <p className="mb-2 text-xs" style={{ color: "var(--ts-warn)" }}>
            {t("albums.hiddenSelections", { count: hiddenSelectedCount })}
          </p>
        )}

        <ul className="space-y-2">
          {filteredAlbums.map((album) => {
            const selection = selected[selectionKey(active, album.id)];
            return (
              <li
                key={album.id}
                className="rounded-sm p-2"
                style={{ border: "1px solid var(--ts-border)" }}
              >
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
                    <span className="block text-xs" style={{ color: "var(--ts-muted)" }}>
                      {t("albums.photoCount", { count: album.assetCount })}
                    </span>
                  </span>
                  {album.linked && (
                    <span className="text-xs" style={{ color: "var(--ts-faint)" }}>
                      {t("albums.alreadyLinked")}
                    </span>
                  )}
                </label>

                {selection && (
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    {(["link", "import"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selection.mode === mode}
                        className="rounded px-2 py-0.5 text-xs"
                        style={
                          selection.mode === mode
                            ? { background: "var(--ts-info)", color: "var(--ts-bg)" }
                            : { border: "1px solid var(--ts-border)" }
                        }
                        onClick={() => setMode(album.id, mode)}
                      >
                        {mode === "link" ? t("modeLink") : t("modeImport")}
                      </button>
                    ))}
                    {selection.estimateBytes !== null && (
                      <span className="text-xs" style={{ color: "var(--ts-warn)" }}>
                        {t("albums.estimate", { size: formatBytes(selection.estimateBytes) })}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </>
    </Modal>
  );
}
