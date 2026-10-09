import { useEffect, useId, useState } from "react";
import type { JSX } from "react";
import { dayInput } from "../../lib/api/timeInput";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { currencyForCountry } from "../../shared/countryCurrency";
import { createStay, updateStay, listMemberships } from "../../lib/api/lodging";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import Modal from "../Modal";
import TagInput from "../TagInput";
import {
  FormErrorBanner,
  RequiredLegend,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import { useLodgingEntrySuggestions } from "../../hooks/useLodgingEntrySuggestions";
import { useStayDatesFromTrip } from "../../hooks/useStayDatesFromTrip";
import { useStayConflicts } from "../../hooks/useStayConflicts";
import { StayConflictNotice } from "./StayConflictNotice";
import { Field } from "../ui/Field";
import { StayEditorAttachmentsSection } from "./StayEditorAttachmentsSection";
import { StayEditorTripSection } from "./StayEditorTripSection";
import { StayEditorBoardSection, StayEditorRoomFields } from "./StayEditorRoomSection";
import { StayEditorSection } from "./StayEditorSection";
import { StayEditorNotesSection } from "./StayEditorNotesSection";
import { StayEditorRatingsSection } from "./StayEditorRatingsSection";
import { StayEditorPriceSection } from "./StayEditorPriceSection";
import { StayEditorDatesSection } from "./StayEditorDatesSection";
import { stayDateErrors, stayDraftFields } from "./stayEditorDraft";
import { derivePricePerNight } from "../../lib/lodgingFormat";
import { deriveStayOverallRating } from "../../shared/ratingDerivation";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import { deriveStayMembership } from "../../shared/membershipDerivation";
import type {
  LodgingStay,
  StayInput,
  BoardType,
  StayStatus,
  LodgingCurrency,
  LodgingMembership,
} from "../../types/lodging";
import type { Trip } from "../../types";

type Mode = "create" | "edit";

interface StayEditorProps {
  mode: Mode;
  lodgingId: string;
  /** The house's name - shown under the title so two stays of one house, or the
   *  same editor opened from a list of stays, say which house they belong to. */
  lodgingName?: string;
  /**
   * One muted line above the form - used by "stay here again" to say what was
   * carried over from the house and what is left to the user (forgejo#227).
   */
  introText?: string;
  /** The hotel's chain, if any - used to derive the covering loyalty card. */
  lodgingChainId?: number | null;
  /**
   * The hotel's country (ISO 3166-1 alpha-2) - decides which currency a NEW
   * stay's price field starts in. Optional: a lodging that has none simply
   * falls through to the account's base currency.
   */
  lodgingCountryCode?: string | null;
  stay?: LodgingStay | null;
  onClose: () => void;
  onSaved: (saved: LodgingStay) => void | Promise<void>;
  /**
   * What the "stored, but the follow-up failed" notice names. The view's
   * wording by default (the detail page reloads one house); a list passes the
   * list's.
   */
  afterSaveFailedKey?: string;
  /**
   * Hands the deletion back to the caller, which owns the confirmation and the
   * request - one deletion path, two entry points (a stay card and this
   * footer). Offered only for a stay that exists; a create form has nothing to
   * delete, so the caller simply omits it.
   */
  onRequestDelete?: () => void;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}

// `pointer-coarse:` - touch sizing follows the POINTER, not the width
// (forgejo#249): an iPad is wide and finger-operated, and a `py-2 text-sm`
// input is ~38 px tall under a 44 px target.
const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none pointer-coarse:min-h-(--ts-size-touch-min)";

// A stay's dates are calendar days, sent as the bare `YYYY-MM-DD` the
// picker gives (ADR 0002): the server stores a DATE, so there is no instant
// to parse. It used to send `T00:00:00.000Z` because the schema ran
// `new Date(v)` on whatever arrived and an offset-less string would have
// been read in the SERVER's zone - the time model removes that parse.
const fromDateInput = (date: string): string | null => dayInput(date);

const splitCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/**
 * Modal editor for one `LodgingStay` (a single visit to a hotel/campsite):
 * dates, room, board, four half-star ratings, price + currency + the
 * award-stay toggle, room amenities, booking reference, a loyalty
 * membership, a trip link, and a receipt upload.
 *
 * It sits in the shared `Modal` frame (it used to be a hand-rolled overlay with
 * no Escape, no focus trap and no scroll lock - forgejo#245-#249), and follows
 * the "enabled save, a refused click focuses the first gap" pattern: required
 * fields carry the shared mark, a refused save names the field it is about and
 * puts focus there. The house form uses the other pattern (disabled save plus
 * `SaveBlockedHint`) because its gaps are not reachable by a click.
 *
 * Loosely modeled on `CruiseEditModal` (segmented status control, collapsible
 * `<StayEditorSection>` blocks). Star pickers and the price/FX block are extracted
 * into their own files to keep this one under the project's file-size limit.
 */
export function StayEditor({
  mode,
  lodgingId,
  lodgingName,
  introText,
  lodgingChainId = null,
  lodgingCountryCode = null,
  stay,
  onClose,
  onSaved,
  afterSaveFailedKey = "common:form.savedButViewRefreshFailed",
  onRequestDelete,
  onReload,
}: StayEditorProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const fid = useId();
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  // ONE source for the starting values, read by the state below AND by the
  // dirty guard: if the two drifted, every edit form would open already
  // "changed" and ask about it.
  //
  // A NEW stay starts in the currency the bill is most likely written in: the
  // hotel's country first, the account's base currency when the country says
  // nothing. It used to start at a literal "EUR" for every hotel on earth, so
  // a US booking was entered in euros unless the user noticed the dropdown
  // (#320). An EXISTING stay keeps what it was saved with - its currency is a
  // recorded fact, not a suggestion.
  const initial = stayDraftFields(
    stay,
    currencyForCountry(lodgingCountryCode) ?? baseCurrency ?? "EUR"
  );

  const [checkIn, setCheckIn] = useState<string>(initial.checkIn);
  const [checkOut, setCheckOut] = useState<string>(initial.checkOut);
  // Optional "HH:mm" wall-clock times for the two days above - so a planned
  // hotel does not "begin" at midnight in the Als-Nächstes countdown. Only
  // offered at DAY precision; submit clears them at any other precision.
  const [checkInTime, setCheckInTime] = useState<string>(initial.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState<string>(initial.checkOutTime);
  // How much of the date the user actually knows. A hotel from 2011 you cannot
  // date is still a place you slept, and rating/price/board all live on the
  // stay - so the alternative to this control was not entering the stay at all.
  const [datePrecision, setDatePrecision] = useState(initial.datePrecision);
  // Only consulted when the dates cannot supply a length. Kept as text so a
  // half-typed value does not become 0.
  const [nightsText, setNightsText] = useState<string>(initial.nightsText);
  // Cancellation is the ONLY status the user decides, so it is the only one
  // held in state. Keeping a full `status` here is what let the editor save a
  // stale "completed" default while the UI displayed the correctly derived
  // value - the state and the derivation were two answers to one question.
  const [isCancelled, setIsCancelled] = useState<boolean>(initial.isCancelled);
  const [roomNumber, setRoomNumber] = useState<string>(initial.roomNumber);
  const [roomCategory, setRoomCategory] = useState<string>(initial.roomCategory);
  const [board, setBoard] = useState<BoardType>(initial.board);

  const [ratingRoom, setRatingRoom] = useState<number | null>(initial.ratingRoom);
  const [ratingBreakfast, setRatingBreakfast] = useState<number | null>(initial.ratingBreakfast);
  const [ratingService, setRatingService] = useState<number | null>(initial.ratingService);

  const [totalPrice, setTotalPrice] = useState<string>(initial.totalPrice);
  const [currency, setCurrency] = useState<LodgingCurrency>(initial.currency);
  // Text, not a number: an empty field means "no rate of my own", which is a
  // different thing from 0 and must reach the API as an explicit null.
  const [manualFxRate, setManualFxRate] = useState<string>(initial.manualFxRate);
  const [isAwardStay, setIsAwardStay] = useState<boolean>(initial.isAwardStay);

  const [roomAmenities, setRoomAmenities] = useState<string[]>(initial.roomAmenities);
  const [bookingReference, setBookingReference] = useState<string>(initial.bookingReference);
  const [membershipId, setMembershipId] = useState<string>(initial.membershipId);
  const [membershipOptOut, setMembershipOptOut] = useState<boolean>(initial.membershipOptOut);
  const [showMembershipOverride, setShowMembershipOverride] = useState<boolean>(
    (stay?.membershipId ?? null) !== null || (stay?.membershipOptOut ?? false)
  );
  const [tripId, setTripId] = useState<string>(initial.tripId);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(initial.receiptUrl);
  const [companionsInput, setCompanionsInput] = useState<string>(initial.companionsInput);
  const [notes, setNotes] = useState<string>(initial.notes);

  const entrySuggestions = useLodgingEntrySuggestions(lodgingId);
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  const tripDates = useStayDatesFromTrip({
    enabled: mode === "create" && datePrecision === "DAY",
    trips,
    tripId,
    checkIn,
    checkOut,
    onCheckInChange: setCheckIn,
    onCheckOutChange: setCheckOut,
  });

  // The draft as the user sees it - the comparable form of every saved field.
  // Same shape as `initial`, so "unchanged" means byte-for-byte what it opened as.
  const draft = {
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    datePrecision,
    nightsText,
    isCancelled,
    roomNumber,
    roomCategory,
    board,
    ratingRoom,
    ratingBreakfast,
    ratingService,
    totalPrice,
    currency,
    manualFxRate,
    isAwardStay,
    roomAmenities,
    bookingReference,
    membershipId,
    membershipOptOut,
    tripId,
    receiptUrl,
    companionsInput,
    notes,
  };
  const { dirty, markSaved } = useDirtyGuard(initial, draft);
  const saving = useSaveOnce<LodgingStay>({ afterSaveFailedKey });
  // A refusal stays until the next edit; focus goes to the first problem.
  const failure = useFormFailure(JSON.stringify(draft));

  // The overlap notice (forgejo#229, forgejo#227): asked on Save, and only for
  // dates the user brought - a new stay, or an edit that moved them. Opening a
  // stay that already overlaps another and fixing its notes must not nag.
  const dateKey = JSON.stringify([datePrecision, checkIn, checkOut, isCancelled]);
  const initialDateKey = JSON.stringify([
    initial.datePrecision,
    initial.checkIn,
    initial.checkOut,
    initial.isCancelled,
  ]);
  const conflicts = useStayConflicts({ lodgingId, stayId: stay?.id ?? null, dateKey });

  // Date rules show from the first save attempt on, then live: nobody is
  // scolded mid-keystroke, and a fixed field stops complaining as soon as it
  // is right. The messages sit BESIDE their fields (forgejo#246).
  const dateErrorKeys = failure.attempted
    ? stayDateErrors({ datePrecision, checkIn, checkOut })
    : {};
  const dateErrors = {
    checkIn: dateErrorKeys.checkIn ? t(dateErrorKeys.checkIn) : undefined,
    checkOut: dateErrorKeys.checkOut ? t(dateErrorKeys.checkOut) : undefined,
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listMemberships();
        if (!cancelled) setMemberships(rows);
      } catch (err: unknown) {
        logger.error("StayEditor: failed to load memberships", err);
      }
    })();
    void (async () => {
      try {
        const rows = await tripsApi.getAll();
        if (!cancelled) setTrips(rows);
      } catch (err: unknown) {
        logger.error("StayEditor: failed to load trips", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // What the backend will store for these dates. Shown next to the cancelled
  // checkbox so the derived state is visible rather than a surprise after save.
  // With no dates the deriver has nothing to work from and returns `current`.
  // "completed" is the right default there: an undated stay is one being
  // recorded after the fact.
  const derivedStatus = deriveLodgingStatus({
    checkIn: datePrecision === "NONE" || !checkIn ? null : new Date(checkIn),
    checkOut: datePrecision !== "DAY" || !checkOut ? null : new Date(checkOut),
    current: datePrecision === "NONE" ? "completed" : "scheduled",
  }) as StayStatus;
  // The single value the save path sends - no second source to drift from.
  const effectiveStatus: StayStatus = isCancelled ? "cancelled" : derivedStatus;

  const parsedTotalPrice = totalPrice.trim() ? Number.parseFloat(totalPrice) : null;
  const parsedManualFxRate =
    manualFxRate.trim() && Number.isFinite(Number.parseFloat(manualFxRate))
      ? Number.parseFloat(manualFxRate)
      : null;
  // The SAME function the server runs on save (shared/ratingDerivation.ts), so
  // the readout cannot promise a number the backend then stores differently.
  // `current` carries an overall the stay already has with no components behind
  // it - an import, or a row from before the components existed. Without it,
  // merely opening such a stay and saving would wipe the user's own score.
  const derivedRatingOverall = deriveStayOverallRating({
    room: ratingRoom,
    breakfast: ratingBreakfast,
    service: ratingService,
    current: stay?.ratingOverall ?? null,
  });
  const derivedPricePerNight = derivePricePerNight(
    Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
    checkIn,
    checkOut
  );

  // The SAME function the server resolves with (shared/membershipDerivation.ts).
  // `membershipId` is an OVERRIDE, never the answer - a card attached to the
  // hotel's chain covers this stay without the user restating it here.
  const resolvedMembership = deriveStayMembership({
    overrideId: membershipId || null,
    optOut: membershipOptOut,
    lodgingId,
    lodgingChainId: lodgingChainId ?? null,
    memberships: memberships.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      chainIds: m.chainIds,
      lodgingIds: m.lodgingIds,
    })),
  });
  const resolvedMembershipName =
    memberships.find((m) => m.id === resolvedMembership.membershipId)?.programName ?? null;

  const parsedNights =
    nightsText.trim() && Number.isFinite(Number.parseInt(nightsText, 10))
      ? Math.max(0, Number.parseInt(nightsText, 10))
      : null;

  const submit = async (): Promise<void> => {
    failure.markAttempted();
    // A refusal that names its field: focus goes to the first gap and nothing
    // is sent.
    if (Object.keys(stayDateErrors({ datePrecision, checkIn, checkOut })).length > 0) {
      failure.focusFirstProblem();
      return;
    }
    if (mode === "edit" && !stay) {
      // Defensive only - callers always pass `stay` in edit mode. Surfaces
      // as a clean error instead of a runtime throw on the cast below.
      failure.fail("lodging:stayEditor.saveError");
      return;
    }
    if (mode === "create" || dateKey !== initialDateKey) {
      const verdict = await conflicts.check({
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        datePrecision,
        cancelled: isCancelled,
      });
      // The notice is up and has focus; nothing was sent.
      if (verdict === "ask") return;
    }
    const input: StayInput = {
      // At NONE precision both dates are cleared outright rather than left
      // as whatever the form last held - a hidden date would be stored and
      // then bucketed as if the user had meant it.
      checkIn: datePrecision === "NONE" ? null : checkIn ? fromDateInput(checkIn) : null,
      checkOut: datePrecision === "DAY" && checkOut ? fromDateInput(checkOut) : null,
      // A time is a claim about a DAY-precise date - anything else clears
      // it, matching the backend's invariant (routes/lodging.ts PATCH).
      checkInTime: datePrecision === "DAY" && checkIn && checkInTime ? checkInTime : null,
      checkOutTime: datePrecision === "DAY" && checkOut && checkOutTime ? checkOutTime : null,
      datePrecision,
      nights: parsedNights,
      status: effectiveStatus,
      // `null` (not `undefined`) for every clearable field below - an
      // omitted key means "leave it alone" to the backend PATCH handler,
      // while an explicit `null` means "delete this value" (finding 4).
      // `undefined` would be dropped by JSON.stringify and read back as
      // "unchanged", so a user could never clear a field once set.
      roomNumber: roomNumber.trim() || null,
      roomCategory: roomCategory.trim() || null,
      board,
      // Derived, not typed - still PERSISTED, because importers, the stats
      // service and the API all read the stored column; only the way the
      // user supplies it changed.
      pricePerNight: derivedPricePerNight,
      currency,
      totalPrice: Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
      // An emptied field is an explicit null - the user taking their rate
      // back - and must not collapse into "leave it alone".
      manualFxRate: parsedManualFxRate,
      // MUST reach the payload unconditionally (including `false`, to let
      // an edit turn an award stay back off) - without this, the four
      // POINTS_PRO_* achievements (Task 11) are permanently unreachable.
      isAwardStay,
      ratingRoom,
      ratingBreakfast,
      ratingService,
      // Same rule as pricePerNight: computed here, stored as before, so
      // every consumer of `ratingOverall` keeps working unchanged.
      ratingOverall: derivedRatingOverall,
      roomAmenities,
      bookingReference: bookingReference.trim() || null,
      // Only ever the override - never the derived value. Writing the
      // resolved card back would give the rule a second stored copy, which
      // is exactly how the overall-rating derivation drifted out of the
      // import paths (9fcf5de1).
      membershipId: membershipOptOut ? null : membershipId || null,
      membershipOptOut,
      receiptUrl,
      tripId: tripId || null,
      companions: splitCsv(companionsInput),
      notes: notes.trim() || null,
    };
    failure.clear();
    // The request and what follows it are two steps (forgejo#247): a list or
    // page that fails to reload must not turn a stored stay into "konnte nicht
    // gespeichert werden" - the next click would have created it twice.
    const outcome = await saving.save(
      () =>
        mode === "create" || !stay
          ? createStay(lodgingId, input)
          : updateStay(lodgingId, stay.id, input),
      async (stored) => {
        markSaved();
        await onSaved(stored);
      }
    );
    if (outcome.status === "failed") {
      logger.error("StayEditor: save failed", outcome.error);
      failure.fail(
        saveErrorKey(
          outcome.error,
          "lodging:stayEditor.saveError",
          {},
          { create: mode === "create" || !stay }
        )
      );
    }
  };

  const title =
    mode === "create" ? t("lodging:stayEditor.createTitle") : t("lodging:stayEditor.editTitle");

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      title={
        <>
          {title}
          {lodgingName && (
            <span
              data-testid="stay-editor-house"
              className="block text-sm font-normal text-[var(--text-muted)]"
            >
              {lodgingName}
            </span>
          )}
        </>
      }
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
            {/* Left of the pair, and outlined rather than filled: it sits in the
                same row as Save without competing with it. The caller asks the
                question - this button only opens it. */}
            {onRequestDelete && (
              <button
                type="button"
                data-testid="stay-editor-delete"
                onClick={onRequestDelete}
                disabled={saving.saving}
                className="mr-auto rounded-md border border-[var(--danger)]/50 px-4 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
              >
                {t("common:buttons.delete")}
              </button>
            )}
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
              data-testid="stay-editor-save"
              onClick={(): void => {
                void submit();
              }}
              disabled={saving.saving || saving.saved !== null || conflicts.checking}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef}>
        {introText && (
          <p data-testid="stay-editor-intro" className="mb-3 text-sm text-[var(--text-muted)]">
            {introText}
          </p>
        )}
        <StayEditorDatesSection
          fid={fid}
          t={t}
          inputClassName={INPUT_CLASS}
          datePrecision={datePrecision}
          onPrecisionChange={setDatePrecision}
          checkIn={checkIn}
          onCheckInChange={setCheckIn}
          checkOut={checkOut}
          onCheckOutChange={setCheckOut}
          checkInTime={checkInTime}
          onCheckInTimeChange={setCheckInTime}
          checkOutTime={checkOutTime}
          onCheckOutTimeChange={setCheckOutTime}
          nightsText={nightsText}
          onNightsChange={setNightsText}
          isCancelled={isCancelled}
          onCancelledChange={setIsCancelled}
          derivedStatus={derivedStatus}
          tripOffer={tripDates.offer}
          onAcceptTripOffer={tripDates.accept}
          errors={dateErrors}
        >
          <StayEditorRoomFields
            roomNumber={roomNumber}
            onRoomNumberChange={setRoomNumber}
            roomCategory={roomCategory}
            onRoomCategoryChange={setRoomCategory}
            roomNumberSuggestions={entrySuggestions.roomNumbers}
            roomCategorySuggestions={entrySuggestions.roomCategories}
            fieldIdPrefix={fid}
            inputClassName={INPUT_CLASS}
            t={t}
          />
        </StayEditorDatesSection>

        <StayEditorBoardSection
          board={board}
          onBoardChange={setBoard}
          suggestedBoard={mode === "create" ? (entrySuggestions.boards[0] ?? null) : null}
          t={t}
        />

        <StayEditorSection title={t("lodging:stayEditor.ratingsSection")}>
          <StayEditorRatingsSection
            ratings={{
              ratingRoom,
              ratingBreakfast,
              ratingService,
              ratingOverall: derivedRatingOverall,
            }}
            onChange={(patch): void => {
              if ("ratingRoom" in patch) setRatingRoom(patch.ratingRoom ?? null);
              if ("ratingBreakfast" in patch) setRatingBreakfast(patch.ratingBreakfast ?? null);
              if ("ratingService" in patch) setRatingService(patch.ratingService ?? null);
            }}
            labels={{
              room: t("lodging:field.ratingRoom"),
              breakfast: t("lodging:field.ratingBreakfast"),
              service: t("lodging:field.ratingService"),
              overall: t("lodging:field.ratingOverall"),
            }}
            derivedHint={t("lodging:field.ratingOverallDerived")}
          />
        </StayEditorSection>

        <StayEditorSection title={t("lodging:stayEditor.priceSection")}>
          <StayEditorPriceSection
            totalPrice={totalPrice}
            onTotalPriceChange={setTotalPrice}
            pricePerNight={derivedPricePerNight}
            pricePerNightLabel={t("lodging:field.pricePerNight")}
            currency={currency}
            onCurrencyChange={setCurrency}
            isAwardStay={isAwardStay}
            onAwardStayChange={setIsAwardStay}
            manualFxRate={manualFxRate}
            onManualFxRateChange={setManualFxRate}
            checkInDate={checkIn}
            baseCurrency={baseCurrency}
            language={i18n.language}
            t={t}
            inputClassName={INPUT_CLASS}
          />
        </StayEditorSection>

        <StayEditorSection title={t("lodging:stayEditor.amenitiesSection")}>
          <Field label={t("lodging:field.roomAmenities")} htmlFor={`${fid}-roomAmenities`}>
            <TagInput
              id={`${fid}-roomAmenities`}
              value={roomAmenities}
              onChange={setRoomAmenities}
              suggestions={entrySuggestions.roomAmenities}
              listLabel={t("lodging:field.amenitySuggestions")}
              removeLabel={(name) => t("lodging:field.removeAmenity", { name })}
              placeholder={t("lodging:field.roomAmenitiesPlaceholder")}
              className={INPUT_CLASS}
            />
          </Field>
          <div className="mt-3">
            <Field label={t("lodging:field.bookingReference")} htmlFor={`${fid}-reference`}>
              <input
                id={`${fid}-reference`}
                className={INPUT_CLASS}
                value={bookingReference}
                onChange={(e): void => setBookingReference(e.target.value)}
              />
            </Field>
          </div>
        </StayEditorSection>

        <StayEditorSection title={t("lodging:stayEditor.loyaltySection")}>
          <div data-testid="stay-editor-membership" className="text-sm">
            <span className="text-[var(--text-primary)]">
              {resolvedMembershipName ?? t("lodging:field.noMembership")}
            </span>
            <span className="ml-2 text-xs text-[var(--text-muted)]">
              {t(`lodging:field.membershipSource.${resolvedMembership.source}`)}
            </span>
          </div>
          <button
            type="button"
            data-testid="stay-editor-membership-override-toggle"
            onClick={(): void => setShowMembershipOverride((v) => !v)}
            className="mt-1 text-xs text-[var(--accent)] hover:underline pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("lodging:stayEditor.overrideMembership")}
          </button>
          {showMembershipOverride && (
            <select
              data-testid="stay-editor-membership-select"
              aria-label={t("lodging:field.membership")}
              className={`mt-2 ${INPUT_CLASS}`}
              value={membershipOptOut ? "__none__" : membershipId}
              onChange={(e): void => {
                const v = e.target.value;
                setMembershipOptOut(v === "__none__");
                setMembershipId(v === "__none__" ? "" : v);
              }}
            >
              <option value="">{t("lodging:field.membershipDerive")}</option>
              <option value="__none__">{t("lodging:field.membershipNone")}</option>
              {memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.programName}
                </option>
              ))}
            </select>
          )}
        </StayEditorSection>

        <StayEditorTripSection
          trips={trips}
          tripId={tripId}
          onTripChange={setTripId}
          preselect={mode === "create"}
          checkIn={checkIn}
          inputClassName={INPUT_CLASS}
          t={t}
        />

        <StayEditorAttachmentsSection
          stayId={stay?.id ?? null}
          receiptUrl={receiptUrl}
          onReceiptChange={setReceiptUrl}
          t={t}
          extract={{
            domain: "lodging",
            current: { price: totalPrice, currency, bookingReference },
            onApply: (v) => {
              if (v.price != null) setTotalPrice(String(v.price));
              if (v.currency) setCurrency(v.currency as LodgingCurrency);
              if (v.bookingReference) setBookingReference(v.bookingReference);
            },
          }}
        />

        <StayEditorNotesSection
          guests={stay?.guests ?? null}
          companions={companionsInput}
          onCompanionsChange={setCompanionsInput}
          notes={notes}
          onNotesChange={setNotes}
          fieldIdPrefix={fid}
          t={t}
          inputClassName={INPUT_CLASS}
        />

        {conflicts.notice !== null && (
          <StayConflictNotice
            notice={conflicts.notice}
            checking={conflicts.checking}
            onProceed={() => {
              conflicts.acknowledge();
              void submit();
            }}
            onChangeDates={() => document.getElementById(`${fid}-checkIn`)?.focus()}
            onRetry={() => void submit()}
          />
        )}
        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? () => void submit()
              : undefined
          }
          retryDisabled={saving.saving}
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
        <RequiredLegend className="mt-3" />
      </div>
    </Modal>
  );
}
