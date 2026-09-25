import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import {
  getVisitPhotoSuggestions,
  linkVisitPhotoSuggestions,
  listVisitPhotos,
  type VisitPhotoSuggestions as Suggestions,
} from "../../lib/api/places";
import { useToastStore } from "../../store/toastStore";
import type { PlaceVisitPhoto } from "../../types/placeList";

interface Props {
  visitId: string;
  /** Hands the visit's photos, after a link, to the strip above. */
  onLinked: (photos: PlaceVisitPhoto[]) => void;
}

const keyOf = (s: { kind: string; id: string }): string => `${s.kind}:${s.id}`;

/**
 * "Fotos aus deiner Reise" — photographs of the visit's day taken near the
 * place, from the user's trips and their photo library (package 9, item 2).
 *
 * Asked for on a click, never on mount: a place page lists every visit, and
 * each question may search the photo library for a whole day. The user picks;
 * a pick becomes a LINK, and the server checks every id again before it
 * writes one.
 */
export function VisitPhotoSuggestions({ visitId, onLinked }: Props): JSX.Element {
  const { t } = useTranslation(["places"]);
  const addToast = useToastStore((s) => s.addToast);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await getVisitPhotoSuggestions(visitId));
      setPicked(new Set());
    } catch (err: unknown) {
      logger.error("VisitPhotoSuggestions: load failed", err);
      addToast("error", t("places:photos.suggest.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const link = async (): Promise<void> => {
    if (!result) return;
    const chosen = result.suggestions.filter((s) => picked.has(keyOf(s)));
    setBusy(true);
    try {
      const outcome = await linkVisitPhotoSuggestions(visitId, {
        tripPhotoIds: chosen.filter((s) => s.kind === "trip").map((s) => s.id),
        assetIds: chosen.filter((s) => s.kind === "library").map((s) => s.id),
      });
      onLinked(await listVisitPhotos(visitId));
      addToast("success", t("places:photos.suggest.linked", { count: outcome.linked }));
      setResult({
        ...result,
        suggestions: result.suggestions.filter((s) => !picked.has(keyOf(s))),
      });
      setPicked(new Set());
    } catch (err: unknown) {
      logger.error("VisitPhotoSuggestions: link failed", err);
      addToast("error", t("places:photos.suggest.linkFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (result === null) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="mt-1 self-start text-xs underline-offset-2 hover:underline disabled:opacity-50"
        style={{ color: "var(--text-muted)", background: "none", border: "none", padding: 0 }}
      >
        {busy ? t("places:photos.suggest.loading") : t("places:photos.suggest.open")}
      </button>
    );
  }

  const libraryDown = result.library !== "ok" && result.library !== "notConfigured";
  return (
    <div className="mt-1 flex flex-col gap-2">
      {result.day === null ? (
        <p className="t-caption">{t("places:photos.suggest.undated")}</p>
      ) : result.suggestions.length === 0 ? (
        <p className="t-caption">{t("places:photos.suggest.none")}</p>
      ) : (
        <>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("places:photos.suggest.title")}
          >
            {result.suggestions.map((s) => (
              <SuggestionTile
                key={keyOf(s)}
                url={s.url}
                alt={t(`places:photos.suggest.alt.${s.kind}`)}
                title={t("places:photos.suggest.distance", { metres: s.distanceM })}
                picked={picked.has(keyOf(s))}
                onToggle={() => toggle(keyOf(s))}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => void link()}
            disabled={busy || picked.size === 0}
            className="self-start rounded-md px-3 py-1 text-xs font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {t("places:photos.suggest.link", { count: picked.size })}
          </button>
        </>
      )}
      {libraryDown && <p className="t-caption">{t("places:photos.suggest.libraryDown")}</p>}
    </div>
  );
}

interface TileProps {
  url: string;
  alt: string;
  title: string;
  picked: boolean;
  onToggle: () => void;
}

function SuggestionTile({ url, alt, title, picked, onToggle }: TileProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onToggle}
      title={title}
      style={{
        padding: 0,
        borderRadius: 6,
        border: picked ? "2px solid var(--accent)" : "1px solid var(--color-border)",
        opacity: picked ? 1 : 0.75,
        cursor: "pointer",
      }}
    >
      <img
        src={url}
        alt={alt}
        width={56}
        height={56}
        loading="lazy"
        style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 5, display: "block" }}
      />
    </button>
  );
}
