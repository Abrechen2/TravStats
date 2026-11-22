import { DeadlineFields } from "../deadlines/DeadlineFields";
import { type DeadlineDraft } from "../deadlines/deadlineDraft";
import { useId, useState } from "react";
import type { JSX } from "react";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import { useTranslation } from "../../hooks/useTranslation";
import { withRating } from "./ratingFields";
import { useSettingsStore } from "../../store/settingsStore";
import { currencyForCountry } from "../../shared/countryCurrency";
import { createStay, updateStay } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import Modal from "../Modal";
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
import { StayEditorFooter } from "./StayEditorFooter";
import { StayEditorAmenitiesSection, StayEditorLoyaltySection } from "./StayEditorExtraSections";
import { useStayDerived } from "./useStayDerived";
import { useStayEditorLookups } from "./useStayEditorLookups";
import { buildStayInput } from "./stayEditorInput";
import { INPUT_CLASS } from "./stayEditorShared";
import { StayConflictNotice } from "./StayConflictNotice";
import { StayEditorAttachmentsSection } from "./StayEditorAttachmentsSection";
import { StayEditorTripSection } from "./StayEditorTripSection";
import { StayEditorBoardSection, StayEditorRoomFields } from "./StayEditorRoomSection";
import { StayEditorSection } from "./StayEditorSection";
import { StayEditorNotesSection } from "./StayEditorNotesSection";
import { StayEditorRatingsSection } from "./StayEditorRatingsSection";
import { StayEditorPriceSection } from "./StayEditorPriceSection";
import { StayEditorDatesSection } from "./StayEditorDatesSection";
import { stayDateErrors, stayDraftFields } from "./stayEditorDraft";
import type { LodgingStay, BoardType, LodgingCurrency } from "../../types/lodging";

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
  /** The gap calendar's days: a new stay opens with them as check-in and check-out. */
  initialDates?: { from: string; to: string };
}

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
  initialDates,
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
    currencyForCountry(lodgingCountryCode) ?? baseCurrency ?? "EUR",
    initialDates
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

  const [ratings, setRatings] = useState<Record<string, number>>(initial.ratings);

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
  const [deadlines, setDeadlines] = useState<DeadlineDraft>(initial.deadlines);

  const entrySuggestions = useLodgingEntrySuggestions(lodgingId);
  const { memberships, trips } = useStayEditorLookups();

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
    ratings,
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
    deadlines,
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

  const {
    derivedStatus,
    effectiveStatus,
    parsedTotalPrice,
    parsedManualFxRate,
    derivedRatingOverall,
    activeRatingFields,
    retiredRatingFields,
    derivedPricePerNight,
    resolvedMembership,
    resolvedMembershipName,
    parsedNights,
  } = useStayDerived({
    datePrecision,
    checkIn,
    checkOut,
    isCancelled,
    nightsText,
    totalPrice,
    manualFxRate,
    ratings,
    stay,
    membershipId,
    membershipOptOut,
    lodgingId,
    lodgingChainId,
    memberships,
  });

  const submit = async (): Promise<void> => {
    failure.markAttempted();
    // A refusal that names its field: focus goes to the first gap and nothing
    // is sent.
    if (Object.keys(stayDateErrors({ datePrecision, checkIn, checkOut })).length > 0) {
      failure.focusFirstProblem();
      return;
    }
    if (
      parsedTotalPrice !== null &&
      !(Number.isFinite(parsedTotalPrice) && parsedTotalPrice >= 0)
    ) {
      failure.fail("lodging:stayEditor.invalidPrice");
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
    const input = buildStayInput({
      stay,
      datePrecision,
      checkIn,
      checkOut,
      checkInTime,
      checkOutTime,
      parsedNights,
      effectiveStatus,
      roomNumber,
      roomCategory,
      board,
      derivedPricePerNight,
      currency,
      parsedTotalPrice: Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
      parsedManualFxRate,
      isAwardStay,
      ratings,
      derivedRatingOverall,
      roomAmenities,
      bookingReference,
      membershipId,
      membershipOptOut,
      receiptUrl,
      tripId,
      companionsInput,
      notes,
      deadlines,
      initialDeadlines: initial.deadlines,
    });
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
      footer={(requestClose) => (
        <StayEditorFooter
          saving={saving}
          checking={conflicts.checking}
          onClose={onClose}
          requestClose={requestClose}
          onRequestDelete={onRequestDelete}
          submit={submit}
        />
      )}
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
            values={ratings}
            active={activeRatingFields}
            retired={retiredRatingFields}
            overall={derivedRatingOverall}
            onChange={(key, value) => setRatings((prev) => withRating(prev, key, value))}
            labels={{
              overall: t("lodging:field.ratingOverall"),
              derivedHint: t("lodging:field.ratingOverallDerived"),
              none: t("lodging:stayEditor.ratingNoCategories"),
              retiredTitle: t("lodging:stayEditor.ratingRetiredTitle"),
              retiredHint: t("lodging:stayEditor.ratingRetiredHint"),
            }}
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

        <StayEditorAmenitiesSection
          fid={fid}
          roomAmenities={roomAmenities}
          onRoomAmenitiesChange={setRoomAmenities}
          suggestions={entrySuggestions.roomAmenities}
          bookingReference={bookingReference}
          onBookingReferenceChange={setBookingReference}
        />

        <StayEditorSection title={t("common:deadlines.title")}>
          <DeadlineFields draft={deadlines} onChange={setDeadlines} />
        </StayEditorSection>

        <StayEditorLoyaltySection
          resolvedMembership={resolvedMembership}
          resolvedMembershipName={resolvedMembershipName}
          showOverride={showMembershipOverride}
          onToggleOverride={(): void => setShowMembershipOverride((v) => !v)}
          membershipId={membershipId}
          membershipOptOut={membershipOptOut}
          onMembershipChange={(id, optOut): void => {
            setMembershipOptOut(optOut);
            setMembershipId(id);
          }}
          memberships={memberships}
        />

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
