import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal";
import OverflowMenu from "../ui/OverflowMenu";
import PhotoAlbumPicker from "./PhotoAlbumPicker";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import {
  getPhotoChoices,
  savePhotoChoices,
  type AlbumPick,
  type ChoiceTarget,
  type PhotoChoice,
  type PhotoChoices,
} from "../../lib/api/photoChoices";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { EnlargeCorner } from "./photoViewer/EnlargeButton";
import { usePhotoViewer } from "./photoViewer/usePhotoViewer";
import { largeUrl, sourceOf } from "./photoViewer/viewerPhoto";

interface Props {
  target: ChoiceTarget;
  /** After a save changed what is linked, so the surface above re-reads. */
  onSaved: () => void;
  onClose: () => void;
}

const keyOf = (c: { provider: string; assetId: string }): string => `${c.provider}:${c.assetId}`;

/**
 * A photo's wall clock where it was taken, as the server sent it. Read as plain
 * calendar parts (the `UTC` zone below only stops the browser shifting them) —
 * never the viewer's zone and never UTC as a time of day.
 */
export function formatTaken(local: string | null, locale: string): string {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, mo - 1, d, h, mi)));
}

function formatDistance(metres: number | null): string {
  if (metres === null) return "";
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * "3.–7. Mai 2024" for the local days `from`..`to` (`YYYY-MM-DD`). Calendar parts only: the
 * `UTC` zone stops the browser shifting a day that is already the local one.
 */
export function formatWindow(from: string, to: string, locale: string): string {
  const at = (d: string): Date | null => {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  };
  const a = at(from);
  const b = at(to);
  if (!a || !b) return "";
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  // `formatRange` is in every supported browser but not in this build's `lib`.
  const ranged = fmt as Intl.DateTimeFormat & { formatRange(a: Date, b: Date): string };
  return from === to ? fmt.format(a) : ranged.formatRange(a, b);
}

/**
 * "Fotos auswählen": every photo the matcher found for a visit or entry, with
 * the linked ones ticked. It is a dialog (`Modal`): inline, it grew inside the stay list's own
 * scroll box, its close button sank below the fold and the wheel scrolled the box, not the
 * list (rc.43, owner report). Escape, the × and the backdrop close it; with unsaved ticks they
 * ask first. The body is the one scroll container. A tick is the user's own choice and survives every
 * re-run; unticking an automatic one in favour of another swaps it quietly,
 * unticking without a replacement removes it for good. For the photos that do
 * not fit the limit there is a link into the source's own UI. Targets are drawn
 * for a finger: the tiles and buttons are at least 44 px on a coarse pointer.
 */
export function PhotoChoosePanel({ target, onSaved, onClose }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["common"]);
  const coarse = useCoarsePointer();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<PhotoChoices | null>(null);
  const viewer = usePhotoViewer();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Keys the user touched: an automatic link only becomes their own pick when they
  // tick it again, so opening and saving the panel changes nothing.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // "Alle laden" and "Aus Album wählen" change WHAT is listed, never what is linked.
  const [all, setAll] = useState(false);
  const [album, setAlbum] = useState<(AlbumPick & { name: string }) | null>(null);
  const [pickingAlbum, setPickingAlbum] = useState(false);

  // Callers build `target` inline; the key keeps a parent re-render from re-loading the list
  // and wiping the ticks.
  const targetKey = JSON.stringify(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await getPhotoChoices(targetRef.current, { all, album: album ?? undefined });
      setData(next);
      setTicked(new Set(next.choices.filter((c) => c.chosen).map(keyOf)));
      setTouched(new Set());
      setFailed(false);
    } catch (err: unknown) {
      logger.error("PhotoChoosePanel: load failed", err);
      setFailed(true);
    }
  }, [targetKey, all, album]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  const changes = useMemo(() => {
    const choices = data?.choices ?? [];
    return {
      select: choices.filter((c) => ticked.has(keyOf(c)) && (!c.chosen || touched.has(keyOf(c)))),
      deselect: choices.filter((c) => !ticked.has(keyOf(c)) && c.chosen),
    };
  }, [data, ticked, touched]);
  const dirty = changes.select.length > 0 || changes.deselect.length > 0;

  const toggle = (c: PhotoChoice): void => {
    setTouched((prev) => new Set(prev).add(keyOf(c)));
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(keyOf(c))) next.delete(keyOf(c));
      else next.add(keyOf(c));
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const pick = (c: PhotoChoice) => ({ provider: c.provider, assetId: c.assetId });
      const result = await savePhotoChoices(target, {
        select: changes.select.map(pick),
        deselect: changes.deselect.map(pick),
        ...(album
          ? { album: { provider: album.provider, albumId: album.albumId, anyDate: album.anyDate } }
          : {}),
      });
      addToast(
        "success",
        t("common:photoChoose.saved", {
          picked: result.picked,
          removed: result.swapped + result.refused,
        })
      );
      if (result.skipped > 0)
        addToast("error", t("common:photoChoose.skipped", { count: result.skipped }));
      onSaved();
      await load();
    } catch (err: unknown) {
      logger.error("PhotoChoosePanel: save failed", err);
      addToast("error", t("common:photoChoose.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const minSize = coarse ? 44 : 32;
  const states = Object.values(data?.sources ?? {});
  const sourceDown = states.some((s) => s !== "ok" && s !== "notConfigured" && s !== "truncated");
  const truncated = states.includes("truncated");
  const button =
    "rounded-md px-3 text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center";
  const outline = { minHeight: minSize, border: "1px solid var(--color-border)" } as const;
  const inEntry = target.type === "entry";
  const shown = data?.choices.length ?? 0;

  const footer = (requestClose: () => void): JSX.Element => (
    <>
      {data && data.openIn.length > 0 && (
        <OverflowMenu
          label={t("common:entryPhotos.menuLabel")}
          testId="photo-choose-menu"
          entries={data.openIn.map((link) => ({
            key: link.provider,
            testId: `photo-choose-open-${link.provider}`,
            label: t(`common:photoChoose.openIn.${link.provider}`),
            // An external address: the entry's `href` is a router link, so open it here.
            onSelect: () => window.open(link.url, "_blank", "noopener,noreferrer"),
          }))}
        />
      )}
      <button
        type="button"
        onClick={requestClose}
        disabled={saving}
        className={button}
        style={outline}
      >
        {t("common:photoChoose.close")}
      </button>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        className={`${button} bg-(--accent) text-(--bg-base)`}
        style={{ minHeight: minSize }}
      >
        {t("common:photoChoose.save")}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={t("common:photoChoose.title")}
      maxWidth={960}
      dirty={dirty}
      busy={saving}
      testId="photo-choose"
      footer={footer}
    >
      <div className="flex w-full flex-col gap-3">
        {failed && (
          <p role="alert" className="t-caption" style={{ color: "var(--color-danger)" }}>
            {t("common:photoChoose.loadFailed")}
          </p>
        )}
        {pickingAlbum && target.type === "entry" ? (
          <PhotoAlbumPicker
            target={target}
            minSize={minSize}
            onCancel={() => setPickingAlbum(false)}
            onPick={(provider, picked) => {
              setAll(false);
              setAlbum({ provider, albumId: picked.id, anyDate: false, name: picked.albumName });
              setPickingAlbum(false);
            }}
          />
        ) : (
          <>
            {data === null && !failed && (
              <p className="t-caption">{t("common:photoChoose.loading")}</p>
            )}
            {data && (
              <>
                <p className="t-caption">{t("common:photoChoose.hint", { cap: data.cap })}</p>
                {data.window && !data.untimed && (
                  <p className="t-caption" data-testid="photo-choose-window">
                    {album
                      ? t(
                          album.anyDate
                            ? "common:photoChoose.album.windowAny"
                            : "common:photoChoose.album.window",
                          {
                            name: album.name,
                            range: formatWindow(data.window.from, data.window.to, i18n.language),
                          }
                        )
                      : t("common:photoChoose.window", {
                          range: formatWindow(data.window.from, data.window.to, i18n.language),
                        })}
                    {" · "}
                    {t("common:photoChoose.count", { shown, total: data.total ?? shown })}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {inEntry && (
                    <button
                      type="button"
                      onClick={() => setPickingAlbum(true)}
                      disabled={dirty}
                      className={button}
                      style={outline}
                      data-testid="photo-choose-album"
                    >
                      {t("common:photoChoose.album.open")}
                    </button>
                  )}
                  {album && (
                    <>
                      <label
                        className="flex items-center gap-2 text-xs"
                        style={{ minHeight: minSize }}
                      >
                        <input
                          type="checkbox"
                          checked={album.anyDate}
                          disabled={dirty}
                          onChange={(e) => setAlbum({ ...album, anyDate: e.target.checked })}
                        />
                        {t("common:photoChoose.album.anyDate")}
                      </label>
                      <button
                        type="button"
                        onClick={() => setAlbum(null)}
                        disabled={dirty}
                        className={button}
                        style={outline}
                      >
                        {t("common:photoChoose.album.leave")}
                      </button>
                    </>
                  )}
                  {data.thinned && !all && (
                    <button
                      type="button"
                      onClick={() => setAll(true)}
                      disabled={dirty}
                      className={button}
                      style={outline}
                      data-testid="photo-choose-all"
                    >
                      {t("common:photoChoose.loadAll", { total: data.total ?? shown })}
                    </button>
                  )}
                </div>
                {dirty && inEntry && (
                  <p className="t-caption">{t("common:photoChoose.saveFirst")}</p>
                )}
                {data.untimed ? (
                  <p className="t-caption">{t("common:entryPhotos.untimed")}</p>
                ) : data.choices.length === 0 ? (
                  <p className="t-caption">{t("common:photoChoose.none")}</p>
                ) : (
                  <>
                    {viewer.viewer}
                    <ul
                      className="grid w-full gap-3"
                      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}
                    >
                      {data.choices.map((c) => {
                        const on = ticked.has(keyOf(c));
                        return (
                          <li key={keyOf(c)} className="relative flex flex-col gap-1">
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-label={t("common:photoChoose.tile", {
                                state: on
                                  ? t("common:photoChoose.chosen")
                                  : t("common:photoChoose.notChosen"),
                                time: formatTaken(c.takenAtLocal, i18n.language),
                              })}
                              onClick={() => toggle(c)}
                              style={{
                                padding: 0,
                                minWidth: minSize,
                                minHeight: minSize,
                                borderRadius: 6,
                                overflow: "hidden",
                                border: on
                                  ? "3px solid var(--accent)"
                                  : "1px solid var(--color-border)",
                                opacity: on ? 1 : 0.8,
                              }}
                            >
                              <img
                                src={c.url}
                                alt=""
                                loading="lazy"
                                style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover" }}
                              />
                            </button>
                            <EnlargeCorner
                              onOpen={() =>
                                viewer.open(
                                  data.choices.map((x) => ({
                                    id: keyOf(x),
                                    url: largeUrl(x.url),
                                    source: sourceOf(x.provider),
                                  })),
                                  data.choices.indexOf(c)
                                )
                              }
                            />
                            <span
                              className="text-[10px] leading-4"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {formatTaken(c.takenAtLocal, i18n.language)}
                              {c.distanceM !== null && ` · ${formatDistance(c.distanceM)}`}
                              {c.chosen &&
                                ` · ${t(c.provenance === "auto" ? "common:photoChoose.auto" : "common:photoChoose.own")}`}
                              {c.refused && ` · ${t("common:photoChoose.removedBefore")}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {sourceDown && <p className="t-caption">{t("common:entryPhotos.sourceDown")}</p>}
                {truncated && (
                  <p className="t-caption">{t("common:entryPhotos.sourceTruncated")}</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default PhotoChoosePanel;
