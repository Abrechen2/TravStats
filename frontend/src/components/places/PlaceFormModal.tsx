import { useCallback, useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import type { LocationCoordinates } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import { logger } from "../../lib/logger";
import { createPlace, updatePlace } from "../../lib/api/places";
import { listPlaceLists } from "../../lib/api/placeLists";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import type { PlaceList } from "../../types/placeList";
import { useToastStore } from "../../store/toastStore";
import {
  PLACE_CATEGORIES,
  PLACE_CATEGORY_ICONS,
  categoryFromOsmValue,
  type PlaceCategory,
} from "../../shared/placeCategories";
import type { Place } from "../../types/place";
import {
  FormErrorBanner,
  RequiredLegend,
  RequiredMark,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { PLACE_FIELD_MAX, placeFormFields, placePayload } from "./placeFormDraft";
import { assignPlaceToLists } from "./placeListAssign";
import { PlaceListPartialNotice } from "./PlaceListPartialNotice";

const NAME_ID = "place-form-name";
const LOCATION_PREFIX = "place-location";
const HINT_ID = "place-form-save-blocked";

/** Touch sizing follows the pointer (forgejo#249): 44 px on an iPad, dense on a desk. */
const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

interface Props {
  /** Null when creating. */
  place: Place | null;
  onClose: () => void;
  onSaved: (place: Place) => void | Promise<void>;
  /** What the "stored, but the follow-up failed" notice names (`useSaveOnce`). */
  afterSaveFailedKey?: string;
  /** A new place's starting name — the text a list search found nothing for. */
  initialName?: string;
  /**
   * The list this place is created FOR (forgejo#230). The form says the place
   * goes there next, and leaves out its own list picker: the list page files
   * it, once, after the save.
   */
  forList?: string;
}

/**
 * Create or edit a place.
 *
 * The whole location half is `LocationInput`, unchanged: search-as-you-type,
 * a map-click modal, and manual coordinates. Reusing it is what keeps #263
 * fixed here for free — the degraded-geocoder case is handled inside
 * `useLocationSearch`, which says "search is unavailable" rather than the
 * misleading "no results", and the manual paths keep working while it is down.
 *
 * Pattern (forgejo#245): **disabled save + `SaveBlockedHint`**. A place cannot
 * be saved without a name and a position (`lat`/`lon` are NOT NULL), so the
 * button stays greyed out and the hint beside it names what is missing and
 * takes the cursor there. Before, a missing name greyed the button and said
 * nothing at all, and every refusal was a toast that vanished (h-inventory §2).
 */
export function PlaceFormModal({
  place,
  onClose,
  onSaved,
  afterSaveFailedKey,
  initialName = "",
  forList,
}: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const isEdit = place !== null;

  const initial = placeFormFields(place, initialName);
  const [name, setName] = useState(initial.name);
  const [localName, setLocalName] = useState(initial.localName);
  const [category, setCategory] = useState<PlaceCategory>(initial.category);
  const [lat, setLat] = useState<number | null>(initial.lat);
  const [lon, setLon] = useState<number | null>(initial.lon);
  const [address, setAddress] = useState(initial.address);
  const [city, setCity] = useState(initial.city);
  const [country, setCountry] = useState(initial.country);
  const [notes, setNotes] = useState(initial.notes);
  const [visited, setVisited] = useState(initial.visited);
  /**
   * Provenance, never user-editable: it is the dedup key the server matches on,
   * so letting it be typed would let a user collide with their own row. It is
   * state rather than a constant because the picker MINTS it — see
   * `handleLocationChange`.
   *
   * Before that nothing wrote it on create, so every hand-added place was
   * stored with `externalRef: null` and the `@@unique([userId, externalRef])`
   * index on `Place` could never fire. Add the Colosseum by hand, import it
   * later from Google Takeout, and you own two Colosseums — the precondition
   * named in `docs/superpowers/specs/2026-08-25-poi-phase-d-import-design.md` §3.1.
   */
  const [externalRef, setExternalRef] = useState(initial.externalRef);
  // Forgejo #9: out-of-range coordinates used to vanish silently and the
  // record saved without them. LocationInput says so; this names the value at
  // fault beside the save button, so the hint can take the user to it.
  const [badCoordinate, setBadCoordinate] = useState<"lat" | "lon" | null>(null);

  /**
   * Lists to drop the new place into, offered on CREATE only.
   *
   * Not on edit, deliberately: a place already belongs to lists, and a picker
   * that started empty would read as "in no list" and invite someone to fix
   * something that is not broken. Membership is edited where it lives, on the
   * list itself.
   *
   * Subscribed checklists are left out for a harder reason — the server refuses
   * to change their membership at all (409), so offering them would be offering
   * a button that cannot work.
   */
  const [lists, setLists] = useState<PlaceList[]>([]);
  const [selectedLists, setSelectedLists] = useState<string[]>([]);

  /** The stored place while the lists that refused it are on screen. */
  const [stored, setStored] = useState<Place | null>(null);
  const [rejectedLists, setRejectedLists] = useState<string[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);

  useEffect(() => {
    if (isEdit || forList !== undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPlaceLists();
        if (!cancelled) setLists(rows.filter((l) => l.curatedKey === null));
      } catch (err) {
        // The place can still be created; only the shortcut is unavailable.
        logger.error({ err }, "PlaceFormModal: could not load lists");
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [isEdit, forList]);

  const fields = {
    name,
    localName,
    category,
    lat,
    lon,
    address,
    city,
    country,
    notes,
    visited,
    externalRef,
  };
  // The list picks are input the user would lose too; a refused coordinate as
  // well — Escape must not drop it just because it never became a position.
  const snapshot = { ...fields, selectedLists, badCoordinate };
  const { dirty, markSaved } = useDirtyGuard(
    { ...initial, selectedLists: [], badCoordinate: null },
    snapshot
  );
  const saving = useSaveOnce<Place>({ afterSaveFailedKey });
  const failure = useFormFailure(JSON.stringify(snapshot));

  const position: LocationCoordinates | null = lat !== null && lon !== null ? { lat, lon } : null;

  // What keeps "Speichern" greyed out, said beside it (forgejo#245).
  const missing: MissingStep[] = [
    ...(name.trim() === "" ? [{ field: NAME_ID, label: t("places:form.name") }] : []),
    ...(position === null
      ? [{ field: `${LOCATION_PREFIX}-search`, label: t("places:form.missing.position") }]
      : []),
    ...(badCoordinate !== null
      ? [
          {
            field: `${LOCATION_PREFIX}-${badCoordinate}`,
            label: t("places:form.missing.coordinates"),
          },
        ]
      : []),
  ];

  /**
   * A search hit fills everything it knows, but NEVER overwrites something the
   * user has already typed — the same rule StopModal settled on. Picking a
   * second hit to correct a coordinate must not silently revert a name the
   * user rewrote by hand.
   */
  const handleLocationChange = useCallback((sel: LocationSelection): void => {
    setLat(sel.lat);
    setLon(sel.lon);
    // Unlike the name and address below, the identity is NOT kept when the user
    // picks again. Those are text they may have rewritten by hand, so a second
    // hit must not overwrite them; this is a machine key that belongs to the
    // coordinates. Picking a different place makes it a different place — and a
    // hand-typed coordinate carries no identity, so it clears the field rather
    // than leaving the previous hit's ref attached to a point it never named.
    setExternalRef(sel.externalRef ?? "");
    setName((prev) => (prev.trim() === "" && sel.name ? sel.name : prev));
    setLocalName((prev) => (prev.trim() === "" && sel.localName ? sel.localName : prev));
    setAddress((prev) => (prev.trim() === "" && sel.address ? sel.address : prev));
    setCity((prev) => (prev.trim() === "" && sel.city ? sel.city : prev));
    setCountry((prev) => (prev.trim() === "" && sel.country ? sel.country : prev));
    // Only a guess, and only when the user has not chosen: the picker shows
    // it and they can change it. A wrong guess is cheap because nothing but
    // an icon depends on the category.
    setCategory((prev) => (prev === "other" ? categoryFromOsmValue(sel.osmValue) : prev));
  }, []);

  /** Tell the caller — the one step left once the place and its lists are settled. */
  const finish = async (saved: Place): Promise<void> => {
    addToast("success", isEdit ? t("places:form.updated") : t("places:form.created"));
    try {
      await onSaved(saved);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceFormModal: the follow-up after saving failed");
      setFinishFailed(true);
    }
  };

  const handleSave = async (): Promise<void> => {
    const payload = placePayload(fields);
    if (missing.length > 0 || payload === null) return;
    failure.clear();
    // The request and what follows it are two steps (forgejo#247): a list that
    // refuses the place, or a page that fails to reload, must not turn a stored
    // place into "konnte nicht gespeichert werden" — the next click would have
    // created it twice.
    const outcome = await saving.save(
      () => (isEdit ? updatePlace(place.id, payload) : createPlace(payload)),
      async (saved) => {
        markSaved();
        if (!isEdit && selectedLists.length > 0) {
          const { rejected } = await assignPlaceToLists(saved.id, selectedLists);
          if (rejected.length > 0) {
            // Partly done: the place stands, some filing did not. Said in the
            // form, with a retry for exactly those lists (forgejo#247).
            setStored(saved);
            setRejectedLists(rejected);
            return;
          }
        }
        addToast("success", isEdit ? t("places:form.updated") : t("places:form.created"));
        await onSaved(saved);
      }
    );
    if (outcome.status === "failed") {
      logger.error({ err: outcome.error }, "PlaceFormModal: save failed");
      failure.fail(saveErrorKey(outcome.error, "places:form.saveFailed"));
    }
  };

  const retryLists = async (): Promise<void> => {
    if (stored === null || reassigning) return;
    setReassigning(true);
    try {
      const { rejected } = await assignPlaceToLists(stored.id, rejectedLists);
      setRejectedLists(rejected);
      if (rejected.length === 0) await finish(stored);
    } finally {
      setReassigning(false);
    }
  };

  const partial = stored !== null && rejectedLists.length > 0;
  const listName = (id: string): string => lists.find((l) => l.id === id)?.name ?? id;

  return (
    <Modal
      open
      // Once the place is stored, every way out is "continue": the caller must
      // learn of it, or the list behind the dialog would not show the place.
      onClose={partial && stored !== null ? () => void finish(stored) : onClose}
      busy={saving.saving || reassigning}
      dirty={dirty}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      title={isEdit ? t("places:form.editTitle") : t("places:form.createTitle")}
      footer={(requestClose) =>
        saving.afterSaveFailed || finishFailed ? (
          // Stored, but the follow-up failed: the only honest action left is to
          // close. Another "Speichern" would send nothing (`useSaveOnce`).
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button type="button" onClick={onClose} className={`btn-primary ${COARSE}`}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : partial && stored !== null ? (
          <PlaceListPartialNotice
            names={rejectedLists.map(listName)}
            busy={reassigning}
            onRetry={() => void retryLists()}
            onContinue={() => void finish(stored)}
          />
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
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed ${COARSE}`}
              style={
                missing.length === 0
                  ? { background: "var(--domain-poi)", color: "#08221e" }
                  : { background: "var(--bg-muted)", color: "var(--text-muted)" }
              }
            >
              {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef}>
        {forList !== undefined && (
          <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("places:form.forList", { list: forList })}
          </p>
        )}
        <div className="space-y-4">
          {/* FIRST field, as the lodging form already does — it was moved
              there in July for this exact reason and places were never
              brought along (Alex, Discord 2026-08-29). A search hit fills the
              name, so with the search below it a person types the name, then
              watches the search overwrite nothing and wonders why they typed
              it. Searching first turns the fields below into a review step. */}
          <LocationInput
            value={position}
            onChange={handleLocationChange}
            onValidityChange={(valid, field) => setBadCoordinate(valid ? null : (field ?? "lat"))}
            idPrefix={LOCATION_PREFIX}
            label={t("places:form.searchLabel")}
            required
          />

          <Field
            id={NAME_ID}
            label={
              <>
                {t("places:form.name")} <RequiredMark />
              </>
            }
          >
            <input
              id={NAME_ID}
              aria-required="true"
              className={INPUT_CLASS}
              value={name}
              maxLength={PLACE_FIELD_MAX.name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("places:form.namePlaceholder")}
            />
          </Field>

          <Field id="place-form-local-name" label={t("places:form.localName")}>
            <input
              id="place-form-local-name"
              className={INPUT_CLASS}
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder={t("places:form.localNamePlaceholder")}
              maxLength={PLACE_FIELD_MAX.localName}
            />
          </Field>

          <Field id="place-form-category" label={t("places:form.category")}>
            <select
              id="place-form-category"
              className={INPUT_CLASS}
              value={category}
              onChange={(e) => setCategory(e.target.value as PlaceCategory)}
            >
              {PLACE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PLACE_CATEGORY_ICONS[c]} {t(`places:categories.${c}`)}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="place-form-address" label={t("places:form.address")}>
              <input
                id="place-form-address"
                className={INPUT_CLASS}
                value={address}
                maxLength={PLACE_FIELD_MAX.address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field id="place-form-city" label={t("places:form.city")}>
              <input
                id="place-form-city"
                className={INPUT_CLASS}
                value={city}
                maxLength={PLACE_FIELD_MAX.city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
            <Field id="place-form-country" label={t("places:form.country")}>
              <input
                id="place-form-country"
                className={INPUT_CLASS}
                value={country}
                maxLength={PLACE_FIELD_MAX.country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
          </div>

          {!isEdit && lists.length > 0 && (
            <ChipGroup label={t("places:form.addToLists")}>
              {lists.map((list) => {
                const on = selectedLists.includes(list.id);
                return (
                  <button
                    key={list.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSelectedLists((prev) =>
                        prev.includes(list.id)
                          ? prev.filter((id) => id !== list.id)
                          : [...prev, list.id]
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs ${COARSE}`}
                    style={{
                      borderColor: on ? list.color : "var(--color-border)",
                      background: on ? `${list.color}22` : "transparent",
                      color: on ? list.color : "var(--text-secondary)",
                    }}
                  >
                    {list.icon ? `${list.icon} ` : ""}
                    {list.name}
                  </button>
                );
              })}
            </ChipGroup>
          )}

          <ChipGroup label={t("places:form.status")} hintId="place-form-status-hint">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={visited === v}
                onClick={() => setVisited(v)}
                className={`rounded-full px-4 py-2 text-sm ${COARSE}`}
                style={
                  visited === v
                    ? {
                        border: "1px solid var(--domain-poi)",
                        color: "var(--domain-poi)",
                        background: "rgba(94,194,178,0.1)",
                      }
                    : { border: "1px solid var(--color-border)", color: "var(--text-muted)" }
                }
              >
                {v ? t("places:form.wasHere") : t("places:form.onWishlist")}
              </button>
            ))}
          </ChipGroup>
          {/* The default is the wishlist, and saying so beats letting the user
              discover it from a count that did not move. */}
          <p
            id="place-form-status-hint"
            className="-mt-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {t("places:form.statusHint")}
          </p>

          <Field id="place-form-notes" label={t("places:form.notes")}>
            <textarea
              id="place-form-notes"
              className={INPUT_CLASS}
              rows={3}
              value={notes}
              maxLength={PLACE_FIELD_MAX.notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? () => void handleSave()
              : undefined
          }
          retryDisabled={saving.saving}
        />
        <RequiredLegend className="mt-3" />
      </div>
    </Modal>
  );
}

const INPUT_CLASS = `w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] ${COARSE}`;

/** A labelled control; `htmlFor` equals the control's id (rollout rule). */
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** A row of toggle buttons under one visible caption, grouped for a screen reader. */
function ChipGroup({
  label,
  hintId,
  children,
}: {
  label: string;
  hintId?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={hintId}>
      <legend className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
