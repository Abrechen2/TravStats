import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import type { LocationCoordinates } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import { logger } from "../../lib/logger";
import { createPlace, updatePlace } from "../../lib/api/places";
import { addPlaceToList, listPlaceLists } from "../../lib/api/placeLists";
import type { PlaceList } from "../../types/placeList";
import { useToastStore } from "../../store/toastStore";
import {
  PLACE_CATEGORIES,
  PLACE_CATEGORY_ICONS,
  categoryFromOsmValue,
  type PlaceCategory,
} from "../../shared/placeCategories";
import type { Place } from "../../types/place";

interface Props {
  /** Null when creating. */
  place: Place | null;
  onClose: () => void;
  onSaved: (place: Place) => void;
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
 * A place cannot be saved without a position (`lat`/`lon` are NOT NULL), so
 * the submit button stays disabled until one exists. That is enforced here
 * rather than only server-side so the user learns it before typing a name.
 */
export function PlaceFormModal({ place, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const isEdit = place !== null;

  const [name, setName] = useState(place?.name ?? "");
  const [category, setCategory] = useState<PlaceCategory>(place?.category ?? "other");
  const [lat, setLat] = useState<number | null>(place?.lat ?? null);
  const [lon, setLon] = useState<number | null>(place?.lon ?? null);
  const [address, setAddress] = useState(place?.address ?? "");
  const [city, setCity] = useState(place?.city ?? "");
  const [country, setCountry] = useState(place?.country ?? "");
  const [notes, setNotes] = useState(place?.notes ?? "");
  const [visited, setVisited] = useState(place?.visited ?? false);
  /**
   * Provenance, never user-editable: it is the dedup key the server matches on,
   * so letting it be typed would let a user collide with their own row. It is
   * state rather than a constant because the picker now MINTS it — see
   * `handleLocationChange`.
   *
   * Until then nothing wrote it on create, so every hand-added place was stored
   * with `externalRef: null` and the `@@unique([userId, externalRef])` index on
   * `Place` could never fire. Add the Colosseum by hand, import it later from
   * Google Takeout, and you own two Colosseums — the precondition named in
   * `docs/superpowers/specs/2026-08-25-poi-phase-d-import-design.md` §3.1.
   */
  const [externalRef, setExternalRef] = useState(place?.externalRef ?? "");
  const [saving, setSaving] = useState(false);
  // Forgejo #9: out-of-range coordinates used to vanish silently and the
  // record saved without them. LocationInput now says so; this stops the
  // form writing while the user is looking at that message.
  const [coordsValid, setCoordsValid] = useState(true);

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

  useEffect(() => {
    if (isEdit) return;
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
  }, [isEdit]);

  const position: LocationCoordinates | null = lat !== null && lon !== null ? { lat, lon } : null;

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
    setAddress((prev) => (prev.trim() === "" && sel.address ? sel.address : prev));
    setCity((prev) => (prev.trim() === "" && sel.city ? sel.city : prev));
    setCountry((prev) => (prev.trim() === "" && sel.country ? sel.country : prev));
    // Only a guess, and only when the user has not chosen: the picker shows
    // it and they can change it. A wrong guess is cheap because nothing but
    // an icon depends on the category.
    setCategory((prev) => (prev === "other" ? categoryFromOsmValue(sel.name) : prev));
  }, []);

  const canSave = name.trim() !== "" && position !== null && !saving;

  const submit = useCallback(async (): Promise<void> => {
    if (!canSave || position === null) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        lat: position.lat,
        lon: position.lon,
        address: address.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        notes: notes.trim() || null,
        visited,
        externalRef: externalRef.trim() || null,
      };
      const saved = isEdit ? await updatePlace(place.id, payload) : await createPlace(payload);

      // The place exists at this point. A list that refuses the membership is
      // reported and does not undo the creation — losing a place because one
      // list said no would be a far worse trade than an unfiled place.
      const rejected: string[] = [];
      if (!isEdit && selectedLists.length > 0) {
        for (const listId of selectedLists) {
          try {
            await addPlaceToList(listId, saved.id);
          } catch (err) {
            logger.error({ err, listId }, "PlaceFormModal: could not add to list");
            rejected.push(lists.find((l) => l.id === listId)?.name ?? listId);
          }
        }
      }

      addToast("success", isEdit ? t("places:form.updated") : t("places:form.created"));
      if (rejected.length > 0) {
        addToast("error", t("places:form.listAddFailed", { lists: rejected.join(", ") }));
      }
      onSaved(saved);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceFormModal: save failed");
      addToast("error", t("places:form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    position,
    name,
    category,
    address,
    city,
    country,
    notes,
    visited,
    externalRef,
    isEdit,
    place,
    addToast,
    t,
    onSaved,
    selectedLists,
    lists,
  ]);

  // The shared frame the three other domain edit dialogs use. This one already
  // brought its own Escape handler and its own backdrop — which is exactly the
  // duplication the frame exists to end. It also gains the scroll lock and the
  // focus return to whatever opened it.
  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      widthClass="max-w-2xl"
      closeLabel={t("common:buttons.close")}
      title={isEdit ? t("places:form.editTitle") : t("places:form.createTitle")}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSave || !coordsValid}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{
              background: canSave ? "var(--domain-poi)" : "var(--bg-muted)",
              color: canSave ? "#08221e" : "var(--text-muted)",
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </>
      }
    >
      <>
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
            onValidityChange={setCoordsValid}
            idPrefix="place-location"
            label={t("places:form.searchLabel")}
          />

          <Field label={t("places:form.name")}>
            <input
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("places:form.namePlaceholder")}
            />
          </Field>

          <Field label={t("places:form.category")}>
            <select
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
            <Field label={t("places:form.address")}>
              <input
                className={INPUT_CLASS}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field label={t("places:form.city")}>
              <input
                className={INPUT_CLASS}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
            <Field label={t("places:form.country")}>
              <input
                className={INPUT_CLASS}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
          </div>

          {!isEdit && lists.length > 0 && (
            <Field label={t("places:form.addToLists")}>
              <div className="flex flex-wrap gap-2">
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
                      className="rounded-full border px-3 py-1 text-xs"
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
              </div>
            </Field>
          )}

          <Field label={t("places:form.status")}>
            <div className="flex gap-2">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setVisited(v)}
                  className="rounded-full px-4 py-2 text-sm"
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
            </div>
            {/* The default is the wishlist, and saying so beats letting the
                user discover it from a count that did not move. */}
            <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {t("places:form.statusHint")}
            </p>
          </Field>

          <Field label={t("places:form.notes")}>
            <textarea
              className={INPUT_CLASS}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        {position === null && (
          <p className="mt-2 text-right text-xs" style={{ color: "var(--text-muted)" }}>
            {t("places:form.positionRequired")}
          </p>
        )}
      </>
    </Modal>
  );
}

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)]";

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
