import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { usePlaceRelationsResult } from "../../hooks/usePlaceRelations";
import { listPlaces, mergePlace } from "../../lib/api/places";
import { calculateDistance } from "../../lib/geo";
import { logger } from "../../lib/logger";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { PLACE_CATEGORY_ICONS } from "../../shared/placeCategories";
import type { Place } from "../../types/place";
import {
  FormErrorBanner,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { PlaceMergeCompare, mergeGroupId } from "./PlaceMergeCompare";
import { mergeFields, openGroups, type MergeChoices } from "./placeMergeModel";
import { PlaceMergeImpact } from "./PlaceMergeImpact";
import { PlaceMergeCuratedNotice, curatedPair } from "./PlaceMergeCuratedNotice";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";
const PICK_ID = "place-merge-pick";
const HINT_ID = "place-merge-blocked";
const PICK_OTHER_ID = "place-merge-pick-other";

/** The server's two refusals, said in the reader's language. */
const MERGE_ERROR_KEYS = {
  PLACE_MERGE_BOTH_CURATED: "places:merge.errors.bothCurated",
  PLACE_MERGE_SAME: "places:merge.errors.same",
} as const;

interface Props {
  /** The place whose page this is — it stays; the one picked here is folded in. */
  place: Place;
  onClose: () => void;
  /** After the merge: re-read the page. */
  onMerged: (kept: Place) => void | Promise<void>;
}

/**
 * Merge a duplicate into this place (forgejo#232).
 *
 * 1. Pick the other place — the user's own places, nearest first as an aid.
 *    Nothing is ever merged because two pins are close; proximity only sorts.
 * 2. Compare them side by side and pick, per group, which value the merged
 *    place keeps. Differing groups have NO default: "Zusammenführen" stays
 *    greyed out, and the hint beside it names the groups still open.
 * 3. See what moves before confirming — visits, photos, documents, lists —
 *    and that the other place is deleted afterwards.
 *
 * One request; the server does it in one transaction, so a failure changes
 * nothing and the dialog keeps every choice (`useSaveOnce`, `FormErrorBanner`).
 * Pattern: **disabled save + `SaveBlockedHint`**.
 */
export function PlaceMergeDialog({ place, onClose, onMerged }: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const [others, setOthers] = useState<Place[] | null>(null);
  const [othersFailed, setOthersFailed] = useState(false);
  const [othersAttempt, setOthersAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Place | null>(null);
  const [choices, setChoices] = useState<MergeChoices>({});

  const impact = usePlaceRelationsResult(source?.id ?? null);
  const { dirty, markSaved } = useDirtyGuard(
    { sourceId: null, choices: {} },
    { sourceId: source?.id ?? null, choices }
  );
  const saving = useSaveOnce<Place>({
    afterSaveFailedKey: "common:form.savedButViewRefreshFailed",
  });
  const failure = useFormFailure(JSON.stringify({ s: source?.id ?? null, choices }));

  useEffect(() => {
    let cancelled = false;
    setOthersFailed(false);
    void (async () => {
      try {
        const rows = await listPlaces({});
        if (!cancelled) setOthers(rows.filter((p) => p.id !== place.id));
      } catch (err: unknown) {
        logger.error({ err }, "PlaceMergeDialog: could not load the places to pick from");
        if (!cancelled) setOthersFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place.id, othersAttempt]);

  /** Nearest first — an aid to finding the duplicate, never a decision. */
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (others ?? [])
      .filter(
        (p) =>
          q === "" ||
          p.name.toLowerCase().includes(q) ||
          (p.localName ?? "").toLowerCase().includes(q) ||
          (p.city ?? "").toLowerCase().includes(q)
      )
      .map((p) => ({ p, km: calculateDistance(place.lat, place.lon, p.lat, p.lon) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 12);
  }, [others, query, place]);

  const open = source ? openGroups(place, source, choices) : [];
  // Two different checklist items cannot become one place (review I4): said at
  // pick time, and the only way on is another pick.
  const curatedClash = source !== null && curatedPair(place, source);
  const missing: MissingStep[] =
    source === null
      ? [{ field: PICK_ID, label: t("places:merge.pickStep") }]
      : curatedClash
        ? [{ field: PICK_OTHER_ID, label: t("places:merge.pickStep") }]
        : open.map((g) => ({ field: mergeGroupId(g), label: t(`places:merge.group.${g}`) }));

  const handleMerge = async (): Promise<void> => {
    if (!source || curatedClash) return;
    const fields = mergeFields(place, source, choices);
    if (fields === null) return;
    failure.clear();
    const outcome = await saving.save(
      () => mergePlace(place.id, { sourceId: source.id, fields }),
      async (kept) => {
        markSaved();
        await onMerged(kept);
      }
    );
    if (outcome.status === "failed") {
      logger.error({ err: outcome.error }, "PlaceMergeDialog: merge refused");
      failure.fail(saveErrorKey(outcome.error, "places:merge.failed", MERGE_ERROR_KEYS));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      maxWidth={720}
      closeLabel={t("common:buttons.close")}
      title={t("places:merge.title", { name: place.name })}
      footer={(requestClose) =>
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button type="button" onClick={onClose} className={`btn-primary ${COARSE}`}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={HINT_ID} missing={missing} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving.saving}
              className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("common:buttons.cancel")}
            </button>
            {/* Red: the other place is deleted once everything has moved. */}
            <button
              type="button"
              onClick={() => void handleMerge()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${DELETE_BUTTON_CLASS} ${COARSE}`}
            >
              {saving.saving ? t("common:buttons.saving") : t("places:merge.confirm")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef} className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {t("places:merge.intro", { name: place.name })}
        </p>

        {source === null ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={PICK_ID} className="t-caption">
              {t("places:merge.pickLabel")}
            </label>
            <input
              id={PICK_ID}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("places:merge.pickPlaceholder")}
              className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm ${COARSE}`}
            />
            {othersFailed ? (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                {t("places:merge.pickFailed")}
                <button
                  type="button"
                  onClick={() => setOthersAttempt((n) => n + 1)}
                  className={`underline ${COARSE}`}
                >
                  {t("common:buttons.retry")}
                </button>
              </p>
            ) : others !== null && candidates.length === 0 ? (
              <p className="t-caption">{t("places:merge.pickNone")}</p>
            ) : (
              <ul className="grid gap-1" style={{ listStyle: "none", padding: 0 }}>
                {candidates.map(({ p, km }) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSource(p)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--bg-muted)] ${COARSE}`}
                    >
                      <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="t-caption">
                        {km < 1
                          ? t("places:merge.metres", { count: Math.round(km * 1000) })
                          : t("places:merge.kilometres", { count: Math.round(km) })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t("places:merge.pickedLine", { name: source.name })}</span>
              <button
                type="button"
                onClick={() => {
                  setSource(null);
                  setChoices({});
                }}
                disabled={saving.saving}
                className={`underline ${COARSE}`}
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:merge.pickOther")}
              </button>
            </div>
            {curatedClash && place.curatedItemId && source.curatedItemId ? (
              <PlaceMergeCuratedNotice
                keptName={place.name}
                otherName={source.name}
                keptItem={place.curatedItemId}
                otherItem={source.curatedItemId}
                pickAnotherId={PICK_OTHER_ID}
                onPickAnother={() => {
                  setSource(null);
                  setChoices({});
                }}
              />
            ) : (
              <>
                <PlaceMergeCompare
                  target={place}
                  source={source}
                  choices={choices}
                  onChoose={(group, choice) => setChoices((prev) => ({ ...prev, [group]: choice }))}
                />
                <PlaceMergeImpact
                  keptName={place.name}
                  source={source}
                  relations={impact.relations}
                  countsFailed={impact.failed}
                  visitedEither={place.visited || source.visited}
                />
              </>
            )}
          </>
        )}

        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? () => void handleMerge()
              : undefined
          }
          retryDisabled={saving.saving}
        />
      </div>
    </Modal>
  );
}
