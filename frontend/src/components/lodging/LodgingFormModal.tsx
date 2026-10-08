import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import { createLodging, updateLodging } from "../../lib/api/lodging";
import type { Lodging, LodgingChain, LodgingInput, LodgingType } from "../../types/lodging";
import { logger } from "../../lib/logger";
import { ChainPicker } from "./ChainPicker";
import { LocationInput } from "../location/LocationInput";
import type { LocationCoordinates, LocationSelection } from "../location/LocationInput";
import type { NearbyLodging } from "../../lib/api/openData";
import { LodgingOsmNearby } from "./LodgingOsmNearby";
import { lodgingTypeForKind, osmFillFor } from "./lodgingFromOsm";
import TagInput from "../TagInput";
import { useLodgingEntrySuggestions } from "../../hooks/useLodgingEntrySuggestions";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import {
  FieldError,
  FormErrorBanner,
  RequiredLegend,
  RequiredMark,
  SaveBlockedHint,
  fieldErrorProps,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { lodgingFieldErrors, lodgingFormFields, lodgingFormSnapshot } from "./lodgingFormDraft";
import type { LodgingFieldErrors } from "./lodgingFormDraft";

const LODGING_TYPES: LodgingType[] = ["hotel", "campsite", "guesthouse", "apartment", "hostel"];

const NAME_ID = "lodging-form-name";
const STARS_ID = "lodging-form-stars";
const WEBSITE_ID = "lodging-form-website";
const LOCATION_PREFIX = "lodging-form-location";
const HINT_ID = "lodging-form-save-blocked";

interface LodgingFormModalProps {
  mode: "create" | "edit";
  lodging?: Lodging | null;
  onClose: () => void;
  onSaved: (saved: Lodging) => void | Promise<void>;
  /**
   * What the "stored, but the follow-up failed" notice names. The list's
   * wording by default; the detail page passes the view's.
   */
  afterSaveFailedKey?: string;
}

/**
 * Create/edit form for the `Lodging` place itself (name, type, address,
 * stars, amenities, notes, chain). A lodging can exist independently of any
 * chain ("— unabhängig" in the mockup) — clearing the `ChainPicker` sends
 * `chainId: null`.
 */
export function LodgingFormModal({
  mode,
  lodging,
  onClose,
  onSaved,
  afterSaveFailedKey,
}: LodgingFormModalProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common", "location", "openData"]);
  // ONE source for the starting values, read by the state below AND by the
  // dirty guard: if the two drifted (say `stars` as "" here and as null
  // there), every edit form would open already "changed" and ask about it.
  const initial = lodgingFormFields(lodging);
  const [type, setType] = useState<LodgingType>(initial.type);
  // "hotel" is only the select's starting point, so an OSM pick may replace it
  // on a new lodging — until the user chooses a type themselves.
  const [typeChosen, setTypeChosen] = useState<boolean>(mode === "edit");
  const [osmFilled, setOsmFilled] = useState<string | null>(null);
  const [chain, setChain] = useState<LodgingChain | null>(initial.chain);
  const [name, setName] = useState<string>(initial.name);
  const [address, setAddress] = useState<string>(initial.address);
  const [city, setCity] = useState<string>(initial.city);
  const [country, setCountry] = useState<string>(initial.country);
  const [lat, setLat] = useState<number | null>(initial.lat);
  const [lon, setLon] = useState<number | null>(initial.lon);
  /** The OSM house the user picked from "nearby" — sent so the server can
   *  remember WHICH house this is (stored only while the row has none). */
  const [osmRef, setOsmRef] = useState<string | null>(null);
  /** Where the pin stood before a nearby pick moved it onto the house, so
   *  the move can be taken back. */
  const [pinBeforePick, setPinBeforePick] = useState<LocationCoordinates | null>(null);
  const [stars, setStars] = useState<string>(initial.stars);
  const [amenities, setAmenities] = useState<string[]>(initial.amenities);
  const entrySuggestions = useLodgingEntrySuggestions();
  const [notes, setNotes] = useState<string>(initial.notes);
  const [website, setWebsite] = useState<string>(initial.website);
  // Forgejo #9: out-of-range coordinates used to vanish silently and the
  // record saved without them. LocationInput now says so; this stops the
  // form writing while the user is looking at that message.
  // Which typed coordinate LocationInput refused, if any — so the hint can
  // take the user to the value that is actually wrong.
  const [badCoordinate, setBadCoordinate] = useState<"lat" | "lon" | null>(null);

  const position: LocationCoordinates | null = lat !== null && lon !== null ? { lat, lon } : null;

  const snapshot = lodgingFormSnapshot({
    type,
    chain,
    name,
    address,
    city,
    country,
    lat,
    lon,
    osmRef,
    stars,
    amenities,
    notes,
    website,
    // A refused coordinate is the user's input too: Escape must not drop it
    // silently just because it never became a position. Empty (null) while
    // everything is valid, so it adds nothing to a clean form.
    badCoordinate,
  });
  const { dirty, markSaved } = useDirtyGuard(lodgingFormSnapshot(initial), snapshot);
  const saving = useSaveOnce<Lodging>({ afterSaveFailedKey });
  const snapshotKey = JSON.stringify(snapshot);

  // A refusal stays until the next edit; focus goes to the first problem.
  const failure = useFormFailure(snapshotKey);

  // Field rules the server enforces too (`backend/src/schemas/lodging.ts`).
  // Checked here so the complaint lands AT the field: before, "7 Sterne" came
  // back as the form's one generic sentence, naming nothing. Shown only after
  // the first save attempt, then live, so nobody is scolded mid-keystroke.
  const fieldErrors: LodgingFieldErrors = failure.attempted
    ? lodgingFieldErrors({ stars, website })
    : {};
  const starsError = fieldErrors.stars ? t(fieldErrors.stars) : null;
  const websiteError = fieldErrors.website ? t(fieldErrors.website) : null;

  // What keeps "Speichern" greyed out, said beside it (forgejo#245). The
  // coordinate check lives in a FOLDED section of `LocationInput`; naming it
  // here is the only way a user learns of it without opening that section.
  const missing: MissingStep[] = [
    ...(name.trim().length === 0 ? [{ field: NAME_ID, label: t("lodging:field.name") }] : []),
    ...(badCoordinate !== null
      ? [
          {
            field: `${LOCATION_PREFIX}-${badCoordinate}`,
            label: t("lodging:form.missing.coordinates"),
          },
        ]
      : []),
  ];

  // A selection always reports the picked position; the text fields it
  // ALSO carries (search hit) only overwrite what the user already typed
  // when they're actually present — a coordinate paste or a map drag/click
  // reports just {lat, lon}, so it must never blank out an existing
  // address/city/country. `name` is even more conservative: it's only
  // ever filled while the user hasn't typed one yet (never overwrite user text).
  const handleLocationChange = (selection: LocationSelection): void => {
    setLat(selection.lat);
    setLon(selection.lon);
    // A new position is a new answer to "where": the earlier pick no longer
    // names this place, and there is no pick to undo.
    setOsmRef(null);
    setPinBeforePick(null);
    if (selection.address) setAddress(selection.address);
    if (selection.city) setCity(selection.city);
    if (selection.country) setCountry(selection.country);
    if (selection.name && name.trim().length === 0) setName(selection.name);
  };

  const handleOsmPick = (place: NearbyLodging): void => {
    const { patch, filled } = osmFillFor(place, { name, stars, website, chain });
    if (patch.name !== undefined) setName(patch.name);
    if (patch.stars !== undefined) setStars(patch.stars);
    if (patch.website !== undefined) setWebsite(patch.website);
    if (patch.chain !== undefined) setChain(patch.chain);
    const osmType = typeChosen ? null : lodgingTypeForKind(place.kind);
    if (osmType !== null && osmType !== type) setType(osmType);
    // The pick carries its data (2026-09-26): the house's own position — the
    // search point is only where the search stood — and its OSM identity.
    // The pin moves because the user chose this house; where it stood before
    // stays one click away.
    const pinMoves = position === null || position.lat !== place.lat || position.lon !== place.lon;
    if (pinMoves) {
      setPinBeforePick(position);
      setLat(place.lat);
      setLon(place.lon);
    }
    setOsmRef(place.osmRef);
    const fields = [
      ...filled,
      ...(osmType !== null && osmType !== type ? ["type"] : []),
      ...(pinMoves ? ["position"] : []),
    ];
    setOsmFilled(
      fields.length === 0
        ? t("openData:lodging.nearby.nothingNew", { name: place.name })
        : t("openData:lodging.nearby.filled", {
            fields: fields.map((f) => t(`openData:lodging.field.${f}`)).join(", "),
          })
    );
  };

  const handleClearPosition = (): void => {
    setLat(null);
    setLon(null);
    setPinBeforePick(null);
  };

  const handleRestorePin = (): void => {
    if (pinBeforePick === null) return;
    setLat(pinBeforePick.lat);
    setLon(pinBeforePick.lon);
    setPinBeforePick(null);
  };

  const handleSave = async (): Promise<void> => {
    failure.markAttempted();
    if (Object.keys(lodgingFieldErrors({ stars, website })).length > 0) {
      failure.focusFirstProblem();
      return;
    }
    if (mode === "edit" && !lodging) {
      // Defensive only — callers always pass `lodging` in edit mode.
      failure.fail("lodging:form.saveError");
      return;
    }
    const input: LodgingInput = {
      type,
      name: name.trim(),
      chainId: chain?.id ?? null,
      // `null` (not `undefined`) so an emptied field actually clears the
      // stored value instead of being dropped by JSON.stringify and read
      // back as "unchanged" (finding 4).
      address: address.trim() || null,
      city: city.trim() || null,
      country: country.trim() || null,
      // Explicit `null` (not `undefined`) for the same reason as
      // address/city/country above — clearing the pin must actually
      // clear the stored coords, not be dropped as "unchanged".
      lat,
      lon,
      stars: stars.trim() ? Number.parseInt(stars, 10) : null,
      amenities,
      notes: notes.trim() || null,
      // Empty clears it — same explicit `null` rule as the fields above.
      website: website.trim() || null,
      ...(osmRef !== null && { osmRef }),
    };
    failure.clear();
    // The request and what follows it are two steps (forgejo#247): a list
    // that fails to reload must not turn a stored lodging into "konnte nicht
    // gespeichert werden" — the next click would have created it twice.
    const outcome = await saving.save(
      () =>
        mode === "create" || !lodging ? createLodging(input) : updateLodging(lodging.id, input),
      async (stored) => {
        markSaved();
        await onSaved(stored);
      }
    );
    if (outcome.status === "failed") {
      logger.error("LodgingFormModal: save failed", outcome.error);
      failure.fail(saveErrorKey(outcome.error, "lodging:form.saveError"));
    }
  };

  const title = mode === "create" ? t("lodging:form.createTitle") : t("lodging:form.editTitle");

  // The shared frame keeps the header and the buttons in place and scrolls
  // only the body — which this form needs the moment its map picker opens.
  // It also brings the Escape key, which this dialog did not have: measured in
  // the browser on 23.08., right after the lodging list made it reachable.
  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      closeLabel={t("common:buttons.close")}
      title={title}
      footer={(requestClose) =>
        // Stored, but the follow-up failed: the only honest action left is to
        // close. Another "Speichern" would send nothing (`useSaveOnce`), and
        // a button that does nothing is worse than no button.
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
            >
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
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef}>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* FIRST field, and named "Unterkunft suchen" (Alex, Discord
              2026-07-12). It sat below the name field, but a search hit fills
              the name anyway — so by the time anyone reached it they had
              already typed the hotel name by hand. Searching first makes the
              fields below a review step instead of duplicate typing. */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <LocationInput
              value={position}
              onChange={handleLocationChange}
              onValidityChange={(valid, field) => setBadCoordinate(valid ? null : (field ?? "lat"))}
              label={t("lodging:form.searchLabel")}
              idPrefix={LOCATION_PREFIX}
            />
            {position !== null && (
              <button
                type="button"
                onClick={handleClearPosition}
                className="self-start text-xs text-[var(--text-muted)] hover:underline"
              >
                {t("location:clear")}
              </button>
            )}
            {position !== null && (
              <LodgingOsmNearby lat={position.lat} lon={position.lon} onPick={handleOsmPick} />
            )}
            {osmFilled !== null && (
              <p role="status" className="text-xs text-[var(--text-muted)]">
                {osmFilled}
              </p>
            )}
            {pinBeforePick !== null && (
              <button
                type="button"
                onClick={handleRestorePin}
                className="self-start text-xs text-[var(--text-muted)] hover:underline"
              >
                {t("openData:lodging.nearby.restorePin")}
              </button>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            <span>
              {t("lodging:field.name")} <RequiredMark />
            </span>
            <input
              id={NAME_ID}
              aria-required="true"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.type")}
            <select
              value={type}
              onChange={(e) => {
                setTypeChosen(true);
                setType(e.target.value as LodgingType);
              }}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {LODGING_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {t(`lodging:type.${lt}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.chain")}
            <ChainPicker value={chain} onChange={setChain} />
          </label>
          {/* The error sits OUTSIDE the label: inside it, its text would
              become part of the field's name ("Sterne 1 bis 5 …"). */}
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              {t("lodging:field.stars")}
              <input
                id={STARS_ID}
                type="number"
                min={1}
                max={5}
                value={stars}
                onChange={(e) => setStars(e.target.value)}
                {...fieldErrorProps(STARS_ID, starsError)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <FieldError id={STARS_ID} error={starsError} />
          </div>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.address")}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.city")}
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.country")}
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              {t("lodging:field.website")}
              <input
                id={WEBSITE_ID}
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
                {...fieldErrorProps(WEBSITE_ID, websiteError)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <FieldError id={WEBSITE_ID} error={websiteError} />
          </div>
          <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            <label htmlFor="lodging-form-amenities">{t("lodging:field.amenities")}</label>
            <TagInput
              id="lodging-form-amenities"
              value={amenities}
              onChange={setAmenities}
              suggestions={entrySuggestions.amenities}
              listLabel={t("lodging:field.amenitySuggestions")}
              removeLabel={(name) => t("lodging:field.removeAmenity", { name })}
              placeholder={t("lodging:field.amenitiesPlaceholder")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
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
