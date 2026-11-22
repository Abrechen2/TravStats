import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import {
  coverSuggestionsApi,
  type CoverSourceStatus,
  type CoverSuggestion,
  type CoverSuggestions,
} from "../../lib/api/coverSuggestions";
import { failureKey } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";
import Modal from "../Modal";
import { useCoverCropStore } from "../../store/coverCropStore";

const PROVIDER_NAME = { immich: "Immich", photoprism: "PhotoPrism" } as const;

/**
 * "Deckblatt vorschlagen": up to three photos of the trip with the reasons they
 * were chosen. Nothing is set until the user presses "Als Deckblatt verwenden";
 * "no suggestion" is its own answer with its own sentence, and a source that
 * could not be read is named instead of silently thinning the list.
 */
export default function CoverSuggestDialog({
  tripId,
  onClose,
  onChosen,
}: {
  tripId: string;
  onClose: () => void;
  /** The cover was set: the trip should be reloaded. */
  onChosen: () => void;
}): JSX.Element {
  const { t } = useTranslation(["immich", "common"]);
  const coarse = useCoarsePointer();
  const [result, setResult] = useState<CoverSuggestions | null>(null);
  const [failed, setFailed] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [chooseFailed, setChooseFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setResult(null);
    setFailed(false);
    try {
      setResult(await coverSuggestionsApi.get(tripId));
    } catch (err) {
      logger.error("CoverSuggestDialog: load failed", err);
      setFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (s: CoverSuggestion): Promise<void> => {
    setChoosing(s.key);
    setChooseFailed(false);
    try {
      const { coverImageUrl } = await coverSuggestionsApi.apply(tripId, s.apply);
      onChosen();
      useCoverCropStore
        .getState()
        .open({ tripId, coverImageUrl, initialCrop: null, onDone: onChosen });
      onClose();
    } catch (err) {
      logger.error("CoverSuggestDialog: choosing failed", err);
      setChooseFailed(true);
    } finally {
      setChoosing(null);
    }
  };

  const notes = result ? sourceNotes(result.sources, t) : [];
  // Only worth saying where a source answered and no person is chosen yet.
  const hints = result
    ? result.sources.filter((s) => s.photos === "ok" && s.people === "notSet")
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      busy={choosing !== null}
      title={t("immich:cover.title")}
      maxWidth={760}
      closeLabel={t("immich:cover.close")}
      testId="cover-suggest-dialog"
      footer={
        <button type="button" className="btn-secondary" onClick={onClose}>
          {t("immich:cover.close")}
        </button>
      }
    >
      <p className="t-caption">{t("immich:cover.intro")}</p>

      {!result && !failed && (
        <p role="status" className="mt-3 text-sm">
          {t("immich:cover.loading")}
        </p>
      )}
      {failed && (
        <div role="alert" className="mt-3 flex flex-col gap-2">
          <p className="font-medium" style={{ color: token("bad") }}>
            {t("immich:cover.loadFailed")}
          </p>
          <button type="button" className="btn-secondary self-start" onClick={() => void load()}>
            {t("immich:cover.retry")}
          </button>
        </div>
      )}

      {notes.map((note) => (
        <p key={note.key} role="alert" className="mt-3 text-sm" style={{ color: token("bad") }}>
          {note.text}
        </p>
      ))}

      {hints.map((s) => (
        <p key={s.provider} className="t-caption mt-3">
          {t("immich:cover.source.peopleNotSet", { name: PROVIDER_NAME[s.provider] })}
        </p>
      ))}

      {result && result.suggestions.length === 0 && result.abstained && (
        <p role="status" className="mt-3 text-sm" data-testid="cover-abstained">
          {t(`immich:cover.abstained.${result.abstained}`)}
        </p>
      )}

      {result && result.suggestions.length > 0 && (
        <ol
          className="mt-3 grid list-none gap-4 p-0"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}
        >
          {result.suggestions.map((s, index) => (
            <li
              key={s.key}
              className="flex flex-col gap-2"
              style={{
                border: "1px solid var(--ts-border)",
                borderRadius: "var(--ts-radius-card)",
                padding: "var(--ts-space-sm)",
              }}
              data-testid="cover-suggestion"
            >
              <img
                src={s.thumbUrl}
                alt={t("immich:cover.photoAlt", { n: index + 1 })}
                loading="lazy"
                style={{
                  width: "100%",
                  aspectRatio: "4 / 3",
                  objectFit: "cover",
                  borderRadius: "var(--ts-radius-tile)",
                }}
              />
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {s.reasons.map((r) => (
                  <li key={r.code}>{t(`immich:cover.reasons.${r.code}`)}</li>
                ))}
              </ul>
              <span className="t-caption">{t("immich:cover.score", { score: s.score })}</span>
              <button
                type="button"
                className="btn-primary mt-auto"
                style={coarse ? { minHeight: "var(--ts-size-touch-min)" } : undefined}
                disabled={choosing !== null}
                onClick={() => void choose(s)}
              >
                {choosing === s.key ? t("immich:cover.choosing") : t("immich:cover.choose")}
              </button>
            </li>
          ))}
        </ol>
      )}

      {chooseFailed && (
        <p role="alert" className="mt-3 font-medium" style={{ color: token("bad") }}>
          {t("immich:cover.chooseFailed")}
        </p>
      )}
    </Modal>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** One line per source that could not be read, or that has no "Das bin ich" yet. */
function sourceNotes(
  sources: CoverSourceStatus[],
  t: Translate
): Array<{ key: string; text: string }> {
  const notes: Array<{ key: string; text: string }> = [];
  for (const s of sources) {
    const name = PROVIDER_NAME[s.provider];
    if (s.photos !== "ok") {
      notes.push({
        key: `${s.provider}-photos`,
        text: t("immich:cover.source.photosFailed", {
          name,
          reason: t(`immich:${failureKey(s.photos, s.provider)}`),
        }),
      });
    } else if (s.people !== "ok" && s.people !== "notSet" && s.people !== "notConfigured") {
      notes.push({
        key: `${s.provider}-people`,
        text: t("immich:cover.source.peopleFailed", {
          name,
          reason: t(`immich:${failureKey(s.people, s.provider)}`),
        }),
      });
    }
  }
  return notes;
}
