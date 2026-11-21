import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import {
  getPhotoChoices,
  savePhotoChoices,
  type ChoiceTarget,
  type PhotoChoice,
  type PhotoChoices,
} from "../../lib/api/photoChoices";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";

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
 * "Fotos auswählen": every photo the matcher found for a visit or entry, with
 * the linked ones ticked. A tick is the user's own choice and survives every
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
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Keys the user touched: an automatic link only becomes their own pick when they
  // tick it again, so opening and saving the panel changes nothing.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await getPhotoChoices(target);
      setData(next);
      setTicked(new Set(next.choices.filter((c) => c.chosen).map(keyOf)));
      setTouched(new Set());
      setFailed(false);
    } catch (err: unknown) {
      logger.error("PhotoChoosePanel: load failed", err);
      setFailed(true);
    }
  }, [target]);

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

  return (
    <section
      aria-label={t("common:photoChoose.title")}
      data-testid="photo-choose"
      className="flex w-full flex-col gap-3"
    >
      <h4 className="t-label">{t("common:photoChoose.title")}</h4>
      {failed && (
        <p role="alert" className="t-caption" style={{ color: "var(--color-danger, #b91c1c)" }}>
          {t("common:photoChoose.loadFailed")}
        </p>
      )}
      {data === null && !failed && <p className="t-caption">{t("common:photoChoose.loading")}</p>}
      {data && (
        <>
          <p className="t-caption">{t("common:photoChoose.hint", { cap: data.cap })}</p>
          {data.untimed ? (
            <p className="t-caption">{t("common:entryPhotos.untimed")}</p>
          ) : data.choices.length === 0 ? (
            <p className="t-caption">{t("common:photoChoose.none")}</p>
          ) : (
            <ul
              className="grid w-full gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}
            >
              {data.choices.map((c) => {
                const on = ticked.has(keyOf(c));
                return (
                  <li key={keyOf(c)} className="flex flex-col gap-1">
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
                        border: on ? "3px solid var(--accent)" : "1px solid var(--color-border)",
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
                    <span className="text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
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
          )}
          {sourceDown && <p className="t-caption">{t("common:entryPhotos.sourceDown")}</p>}
          {truncated && <p className="t-caption">{t("common:entryPhotos.sourceTruncated")}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className={`${button} bg-(--accent) text-(--bg-base)`}
              style={{ minHeight: minSize }}
            >
              {t("common:photoChoose.save")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={button}
              style={{ minHeight: minSize, border: "1px solid var(--color-border)" }}
            >
              {t("common:photoChoose.close")}
            </button>
            {data.openIn.map((link) => (
              <a
                key={link.provider}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={button}
                style={{ minHeight: minSize, border: "1px solid var(--color-border)" }}
              >
                {t(`common:photoChoose.openIn.${link.provider}`)}
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default PhotoChoosePanel;
