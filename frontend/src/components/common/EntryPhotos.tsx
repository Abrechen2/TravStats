import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  clearEntryPhotoRefusals,
  getEntryPhotoSuggestions,
  linkEntryPhotos,
  listEntryPhotos,
  removeAutoEntryPhotos,
  removeEntryPhoto,
  type EntryPhotoKind,
  type EntryPhotoLink,
  type EntryPhotoProvider,
  type EntryPhotoSuggestions,
} from "../../lib/api/entryPhotos";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import PhotoChoosePanel from "./PhotoChoosePanel";
import DetailSection from "../ui/DetailSection";
import OverflowMenu, { type OverflowEntry } from "../ui/OverflowMenu";
import InlineError from "../ui/InlineError";

interface Props {
  kind: EntryPhotoKind;
  entryId: string;
  /** False where a surrounding section already carries the title. */
  heading?: boolean;
}

const PROVIDERS: EntryPhotoProvider[] = ["immich", "photoprism"];
const keyOf = (s: { provider: string; assetId: string }): string => `${s.provider}:${s.assetId}`;
const TILE = 72;

/**
 * Photos of one entry — a flight, a stay, a journey, a rental, a cruise stop, a
 * roadtrip station — linked from the user's Immich / PhotoPrism library. The
 * same component on every detail view. Links are made by the server on its own
 * ("automatisch verknüpft"); the user removes one (the server remembers the
 * refusal) or adds from what the matcher found. A failing photo source is said
 * on screen, never shown as "no photos".
 */
export function EntryPhotos({ kind, entryId, heading = true }: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [photos, setPhotos] = useState<EntryPhotoLink[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [found, setFound] = useState<EntryPhotoSuggestions | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setPhotos(await listEntryPhotos(kind, entryId));
      setLoadFailed(false);
    } catch (err: unknown) {
      logger.error("EntryPhotos: load failed", err);
      setLoadFailed(true);
    }
  }, [kind, entryId]);

  useEffect(() => {
    setFound(null);
    setPicked(new Set());
    void reload();
  }, [reload]);

  const guarded = async (work: () => Promise<void>, failure: string): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } catch (err: unknown) {
      logger.error("EntryPhotos: action failed", err);
      addToast("error", failure);
    } finally {
      setBusy(false);
    }
  };

  const source = (p: EntryPhotoLink): string => t(`common:entryPhotos.source.${p.provider}`);
  const label = (p: EntryPhotoLink): string =>
    t(p.provenance === "auto" ? "common:entryPhotos.autoLabel" : "common:entryPhotos.manualLabel", {
      source: source(p),
    });

  const remove = (photo: EntryPhotoLink): Promise<void> =>
    guarded(async () => {
      await removeEntryPhoto(kind, entryId, photo.id);
      setPhotos((prev) => (prev ?? []).filter((p) => p.id !== photo.id));
      addToast("success", t("common:entryPhotos.removed"));
    }, t("common:entryPhotos.removeFailed"));

  const removeAuto = (): Promise<void> =>
    guarded(async () => {
      await removeAutoEntryPhotos(kind, entryId);
      await reload();
    }, t("common:entryPhotos.removeAllFailed"));

  const search = (): Promise<void> =>
    guarded(async () => {
      setFound(await getEntryPhotoSuggestions(kind, entryId));
      setPicked(new Set());
    }, t("common:entryPhotos.suggestFailed"));

  const undoRefusals = (): Promise<void> =>
    guarded(async () => {
      await clearEntryPhotoRefusals(kind, entryId);
      setFound(await getEntryPhotoSuggestions(kind, entryId));
    }, t("common:entryPhotos.undoFailed"));

  const link = (): Promise<void> =>
    guarded(async () => {
      if (!found) return;
      let linked = 0;
      // One request per photo source: an asset id is only unique within its source.
      for (const provider of PROVIDERS) {
        const ids = found.suggestions
          .filter((s) => s.provider === provider && picked.has(keyOf(s)))
          .map((s) => s.assetId);
        if (ids.length > 0) linked += (await linkEntryPhotos(kind, entryId, provider, ids)).linked;
      }
      addToast("success", t("common:entryPhotos.linked", { count: linked }));
      setFound({ ...found, suggestions: found.suggestions.filter((s) => !picked.has(keyOf(s))) });
      setPicked(new Set());
      await reload();
    }, t("common:entryPhotos.linkFailed"));

  const toggle = (key: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hasAuto = (photos ?? []).some((p) => p.provenance === "auto");
  const sourceStates = Object.values(found?.sources ?? {});
  const sourceDown = sourceStates.some(
    (s) => s !== "ok" && s !== "notConfigured" && s !== "truncated"
  );
  const truncated = sourceStates.includes("truncated");
  const menuEntries: OverflowEntry[] = [
    ...(choosing
      ? []
      : [
          {
            key: "choose",
            testId: "entry-photos-choose",
            label: t("common:photoChoose.open"),
            onSelect: () => setChoosing(true),
          },
        ]),
    ...(found === null
      ? [
          {
            key: "search",
            testId: "entry-photos-search",
            label: busy ? t("common:entryPhotos.loading") : t("common:entryPhotos.add"),
            disabled: busy,
            onSelect: () => void search(),
          },
        ]
      : [
          {
            key: "undo",
            testId: "entry-photos-undo",
            label: t("common:entryPhotos.undo"),
            disabled: busy,
            onSelect: () => void undoRefusals(),
          },
        ]),
    ...(hasAuto
      ? [
          {
            key: "removeAll",
            testId: "entry-photos-remove-all",
            label: t("common:entryPhotos.removeAll"),
            danger: true,
            disabled: busy,
            confirm: {
              title: t("common:entryPhotos.removeAllConfirmTitle"),
              message: t("common:entryPhotos.removeAllConfirmMessage"),
              confirmText: t("common:entryPhotos.removeAll"),
            },
            onSelect: () => void removeAuto(),
          },
        ]
      : []),
  ];
  const linkButton = "rounded-md px-3 py-1 text-xs font-medium bg-(--accent) text-(--bg-base)";
  const quiet = {
    color: "var(--text-muted)",
    background: "none",
    border: "none",
    padding: 0,
  } as const;

  return (
    <section
      aria-label={t("common:entryPhotos.title")}
      data-testid="entry-photos"
      className="flex w-full flex-col gap-2"
    >
      {/* The photos stay in view; the rare actions are one section ⋯, remove-all last, red and
          confirmed (owner, 2026-11-22). */}
      <div className="flex items-center justify-between gap-2">
        {heading ? <h3 className="t-label">{t("common:entryPhotos.title")}</h3> : <span />}
        <OverflowMenu
          label={t("common:entryPhotos.menuLabel")}
          testId="entry-photos-menu"
          entries={menuEntries}
        />
      </div>
      {loadFailed && <InlineError>{t("common:entryPhotos.loadFailed")}</InlineError>}
      {photos !== null && photos.length === 0 && !loadFailed && (
        <p className="t-caption">{t("common:entryPhotos.none")}</p>
      )}
      {photos !== null && photos.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {photos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1" style={{ width: TILE + 24 }}>
              <img
                src={p.url}
                alt={t("common:entryPhotos.alt")}
                width={TILE}
                height={TILE}
                loading="lazy"
                style={{ width: TILE, height: TILE, objectFit: "cover", borderRadius: 6 }}
              />
              <span className="text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
                {label(p)}
              </span>
              <button
                type="button"
                onClick={() => void remove(p)}
                disabled={busy}
                className="self-start text-[11px] underline-offset-2 hover:underline disabled:opacity-50"
                style={quiet}
              >
                {t("common:entryPhotos.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {choosing ? (
        <PhotoChoosePanel
          target={{ type: "entry", kind, entryId }}
          onSaved={() => void reload()}
          onClose={() => setChoosing(false)}
        />
      ) : null}
      {found !== null && (
        <div className="flex flex-col gap-2">
          {found.untimed ? (
            <p className="t-caption">{t("common:entryPhotos.untimed")}</p>
          ) : found.suggestions.length === 0 ? (
            <p className="t-caption">{t("common:entryPhotos.suggestNone")}</p>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t("common:entryPhotos.add")}
              >
                {found.suggestions.map((s) => (
                  <button
                    key={keyOf(s)}
                    type="button"
                    aria-pressed={picked.has(keyOf(s))}
                    onClick={() => toggle(keyOf(s))}
                    style={{
                      padding: 0,
                      borderRadius: 6,
                      border: picked.has(keyOf(s))
                        ? "2px solid var(--accent)"
                        : "1px solid var(--color-border)",
                      opacity: picked.has(keyOf(s)) ? 1 : 0.75,
                    }}
                  >
                    <img
                      src={s.url}
                      alt={t("common:entryPhotos.alt")}
                      width={56}
                      height={56}
                      loading="lazy"
                      style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 5 }}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void link()}
                disabled={busy || picked.size === 0}
                className={`${linkButton} self-start disabled:opacity-50`}
              >
                {t("common:entryPhotos.link", { count: picked.size })}
              </button>
            </>
          )}
          {found.thinned && !found.untimed && (
            <p className="t-caption" data-testid="entry-photos-thinned">
              {t("common:entryPhotos.suggestThinned", {
                shown: found.suggestions.length,
                total: found.total ?? found.suggestions.length,
              })}
            </p>
          )}
          {sourceDown && <p className="t-caption">{t("common:entryPhotos.sourceDown")}</p>}
          {truncated && <p className="t-caption">{t("common:entryPhotos.sourceTruncated")}</p>}
        </div>
      )}
    </section>
  );
}

export default EntryPhotos;

/** The photos as a section of a detail page, in the same card the other sections use. */
export function EntryPhotosSection(props: Omit<Props, "heading">): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <DetailSection title={t("common:entryPhotos.title")}>
      <EntryPhotos {...props} heading={false} />
    </DetailSection>
  );
}
