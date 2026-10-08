import { useId, useRef, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { LocationMapModal } from "../location/LocationMapModal";
import { LocationMiniMap } from "../location/LocationMiniMap";
import type { LocationCoordinates, LocationSelection } from "../location/LocationInput";
import {
  FormErrorBanner,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { searchPlaces, type PlaceSearchResult } from "../../lib/api/geo";
import { updateLodging } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import type { Lodging } from "../../types/lodging";

/** What the user has chosen to take - the pin and a line that says where it is. */
interface Candidate extends LocationCoordinates {
  label: string;
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed" }
  | { status: "done"; results: PlaceSearchResult[] };

const PREVIEW_ZOOM = 13;

/** The text the first search starts from: where the house says it is, else its name. */
export function repairSearchText(
  lodging: Pick<Lodging, "name" | "address" | "city" | "country">
): string {
  const place = [lodging.address, lodging.city, lodging.country]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "");
  // A name alone is the last resort: "Hotel St. Martin" exists in three
  // countries, which is why the user sees the hit and decides (below).
  return (place.length > 0 ? place : [lodging.name.trim()]).join(", ");
}

const hitLabel = (hit: PlaceSearchResult): string =>
  [hit.name, hit.address, hit.city, hit.country].filter(Boolean).join(", ");

interface LodgingLocationRepairProps {
  lodging: Lodging;
  onClose: () => void;
  /** The house as the server now has it. */
  onSaved: (updated: Lodging) => void | Promise<void>;
  afterSaveFailedKey?: string;
}

/**
 * Put a house without a pin on the map, in place (forgejo#228).
 *
 * The notice "no location" used to open the WHOLE house form, whose save
 * re-sends every field and whose geocoding is only a side effect of saving. This
 * is the smaller job done directly: search the address again (with the text
 * editable), or set the point on the map yourself; the result is SHOWN - on a
 * map and in words - before it is taken; and taking it writes exactly the two
 * coordinates (`PATCH /lodging/:id { lat, lon }`). Name, address, stars, notes
 * and the rest are never sent, so they cannot be changed by this dialog.
 *
 * A search that fails is said as failed (not "nothing found") and can be
 * repeated; a save that fails keeps the choice and offers the retry.
 */
export function LodgingLocationRepair({
  lodging,
  onClose,
  onSaved,
  afterSaveFailedKey,
}: LodgingLocationRepairProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "location", "common"]);
  const uid = useId();
  const queryId = `${uid}-query`;
  const hintId = `${uid}-blocked`;

  const [query, setQuery] = useState<string>(repairSearchText(lodging));
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [mapOpen, setMapOpen] = useState<boolean>(false);
  // Which search answered last - a slow reply to an older query must not
  // replace the results of the one on screen.
  const searchSeq = useRef(0);

  const { dirty, markSaved } = useDirtyGuard(null, candidate);
  const saving = useSaveOnce<Lodging>({ afterSaveFailedKey });
  const failure = useFormFailure(JSON.stringify(candidate));

  const runSearch = async (): Promise<void> => {
    const text = query.trim();
    if (text === "") return;
    const seq = ++searchSeq.current;
    setSearch({ status: "searching" });
    try {
      const { results, degraded } = await searchPlaces(text, i18n.language?.split("-")[0]);
      if (seq !== searchSeq.current) return;
      // `degraded`: the geocoder itself failed - an empty list then is NOT
      // "no match", and saying so would send the user to retype a good address.
      setSearch(degraded ? { status: "failed" } : { status: "done", results });
    } catch (err: unknown) {
      if (seq !== searchSeq.current) return;
      logger.error("LodgingLocationRepair: place search failed", err);
      setSearch({ status: "failed" });
    }
  };

  const take = (selection: LocationSelection | PlaceSearchResult, label: string): void => {
    setCandidate({ lat: selection.lat, lon: selection.lon, label });
  };

  const handleSave = async (): Promise<void> => {
    if (candidate === null) return;
    failure.clear();
    const outcome = await saving.save(
      // Exactly the position. Everything else on the house is none of this
      // dialog's business, so none of it is sent.
      () => updateLodging(lodging.id, { lat: candidate.lat, lon: candidate.lon }),
      async (updated) => {
        markSaved();
        await onSaved(updated);
      }
    );
    if (outcome.status === "failed") {
      logger.error("LodgingLocationRepair: save failed", outcome.error);
      failure.fail(saveErrorKey(outcome.error, "lodging:repair.saveError"));
    }
  };

  const missing =
    candidate === null ? [{ field: queryId, label: t("lodging:repair.missing") }] : [];

  return (
    <>
      <Modal
        open
        onClose={onClose}
        busy={saving.saving}
        dirty={dirty}
        maxWidth={560}
        closeLabel={t("common:buttons.close")}
        title={t("lodging:repair.title")}
        footer={(requestClose) =>
          saving.afterSaveFailed ? (
            <>
              <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
                {t(saving.afterSaveFailedKey)}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900"
              >
                {t("common:buttons.close")}
              </button>
            </>
          ) : (
            <>
              <div className="mr-auto self-center">
                <SaveBlockedHint id={hintId} missing={missing} />
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={saving.saving}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] disabled:opacity-50"
              >
                {t("common:buttons.cancel")}
              </button>
              <button
                type="button"
                data-testid="repair-save"
                aria-describedby={hintId}
                disabled={candidate === null || saving.saving || saving.saved !== null}
                onClick={() => void handleSave()}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
              >
                {saving.saving ? t("common:buttons.saving") : t("lodging:repair.take")}
              </button>
            </>
          )
        }
      >
        <div ref={failure.rootRef} className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-muted)]">
            {t("lodging:repair.intro", { name: lodging.name })}
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor={queryId} className="text-xs text-[var(--text-muted)]">
              {t("lodging:repair.queryLabel")}
            </label>
            <div className="flex gap-2">
              <input
                id={queryId}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] pointer-coarse:min-h-(--ts-size-touch-min)"
              />
              <button
                type="button"
                data-testid="repair-search"
                onClick={() => void runSearch()}
                disabled={search.status === "searching" || query.trim() === ""}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)"
              >
                {search.status === "searching"
                  ? t("lodging:repair.searching")
                  : t("lodging:repair.search")}
              </button>
            </div>

            {search.status === "failed" && (
              <p
                role="alert"
                className="flex flex-wrap items-center gap-2 text-sm text-[var(--danger)]"
              >
                {t("lodging:repair.searchFailed")}
                <button
                  type="button"
                  onClick={() => void runSearch()}
                  className="rounded-md border border-[var(--danger)]/50 px-2 py-1 text-xs pointer-coarse:min-h-(--ts-size-touch-min)"
                >
                  {t("common:buttons.retry")}
                </button>
              </p>
            )}
            {search.status === "done" && search.results.length === 0 && (
              <p role="status" className="text-sm text-[var(--text-muted)]">
                {t("lodging:repair.noResults")}
              </p>
            )}
            {search.status === "done" && search.results.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-xs text-[var(--text-muted)]">
                  {t("lodging:repair.resultsLabel")}
                </legend>
                {search.results.map((hit, index) => {
                  const id = `${uid}-hit-${index}`;
                  const label = hitLabel(hit);
                  const checked =
                    candidate !== null && candidate.lat === hit.lat && candidate.lon === hit.lon;
                  return (
                    <label
                      key={id}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                    >
                      <input
                        id={id}
                        type="radio"
                        name={`${uid}-hits`}
                        checked={checked}
                        onChange={() => take(hit, label)}
                        className="mt-1"
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </div>

          <div>
            <button
              type="button"
              data-testid="repair-map"
              onClick={() => setMapOpen(true)}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              {t("lodging:repair.setOnMap")}
            </button>
          </div>

          {candidate !== null && (
            <section aria-label={t("lodging:repair.previewTitle")} data-testid="repair-preview">
              <h3 className="mb-1 text-sm font-medium text-[var(--text-primary)]">
                {t("lodging:repair.previewTitle")}
              </h3>
              <p className="mb-2 text-sm text-[var(--text-muted)]">
                {candidate.label} · {candidate.lat.toFixed(5)}, {candidate.lon.toFixed(5)}
              </p>
              {/* Read-only: no click and no drag handler is the read-only signal.
                  Changing the point goes through the map button above. */}
              <LocationMiniMap
                value={candidate}
                initialViewState={{
                  longitude: candidate.lon,
                  latitude: candidate.lat,
                  zoom: PREVIEW_ZOOM,
                }}
                focusNonce={0}
                compact
                ariaLabel={t("lodging:repair.previewTitle")}
                attributionLabel={t("location:attribution")}
              />
            </section>
          )}

          <FormErrorBanner
            message={failure.failureKey !== null ? t(failure.failureKey) : null}
            onRetry={
              failure.failureKey !== null && isTransientSaveError(failure.failureKey)
                ? () => void handleSave()
                : undefined
            }
            retryDisabled={saving.saving}
          />
        </div>
      </Modal>

      <LocationMapModal
        open={mapOpen}
        value={candidate}
        onClose={() => setMapOpen(false)}
        onConfirm={(selection) => {
          setMapOpen(false);
          const label =
            [selection.name, selection.address, selection.city, selection.country]
              .filter(Boolean)
              .join(", ") || t("lodging:repair.pointOnMap");
          take(selection, label);
        }}
        idPrefix={`${uid}-map`}
      />
    </>
  );
}
