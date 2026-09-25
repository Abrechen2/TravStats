import { useEffect, useId, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { LODGING_DATE_PRECISIONS, type LodgingDatePrecision } from "../../shared/lodgingTiming";
import { useSettingsStore } from "../../store/settingsStore";
import { currencyForCountry } from "../../shared/countryCurrency";
import { createStay, updateStay, listMemberships } from "../../lib/api/lodging";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import TagInput from "../TagInput";
import { useLodgingEntrySuggestions } from "../../hooks/useLodgingEntrySuggestions";
import { useStayDatesFromTrip } from "../../hooks/useStayDatesFromTrip";
import { StayDatesOfferButton } from "./StayDatesOfferButton";
import { Field } from "../ui/Field";
import { StayEditorAttachmentsSection } from "./StayEditorAttachmentsSection";
import { StayEditorTripSection } from "./StayEditorTripSection";
import { StayEditorBoardSection, StayEditorRoomFields } from "./StayEditorRoomSection";
import { StayEditorSection } from "./StayEditorSection";
import { StayEditorNotesSection } from "./StayEditorNotesSection";
import { StayEditorRatingsSection } from "./StayEditorRatingsSection";
import { StayEditorPriceSection } from "./StayEditorPriceSection";
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
  /** The hotel's chain, if any — used to derive the covering loyalty card. */
  lodgingChainId?: number | null;
  /**
   * The hotel's country (ISO 3166-1 alpha-2) — decides which currency a NEW
   * stay's price field starts in. Optional: a lodging that has none simply
   * falls through to the account's base currency.
   */
  lodgingCountryCode?: string | null;
  stay?: LodgingStay | null;
  onClose: () => void;
  onSaved: (saved: LodgingStay) => void | Promise<void>;
  /**
   * Hands the deletion back to the caller, which owns the confirmation and the
   * request — one deletion path, two entry points (a stay card and this
   * footer). Offered only for a stay that exists; a create form has nothing to
   * delete, so the caller simply omits it.
   */
  onRequestDelete?: () => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none";

// color-scheme: dark — see CruiseEditModal.tsx for why date inputs need this.
const DARK_PICKER_STYLE: React.CSSProperties = { colorScheme: "dark" };

const toDateInput = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");

// A stay's dates are calendar days (a check-in has no meaningful time-of-day
// for this app), so a date-only <input type="date"> round-trips through an
// EXPLICIT UTC instant — "YYYY-MM-DDT00:00:00.000Z" — never a bare
// "YYYY-MM-DDTHH:mm:ss" without a "Z"/offset. That distinction matters here:
// the backend's `isoDateTimeRequired` Zod preprocessor
// (schemas/lodging.ts) runs `new Date(v).toISOString()` on whatever string
// arrives. An offset-less datetime string is parsed as SERVER-LOCAL time by
// the JS Date constructor and can shift to a different UTC calendar day —
// and `applyFxSnapshot` snapshots the ECB rate for exactly that (possibly
// shifted) day. Appending "Z" pins the instant to UTC midnight, so the
// snapshot always lands on the calendar day the user actually picked.
const fromDateInput = (date: string): string => `${date}T00:00:00.000Z`;

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
 * Loosely modeled on `CruiseEditModal` (segmented status control, collapsible
 * `<StayEditorSection>` blocks). Star pickers and the price/FX block are extracted
 * into their own files to keep this one under the project's file-size limit.
 */
/** "2011-07" -> "2011-07-01", "2011" -> "2011-01-01"; a day passes through. */
function precisionToIsoDay(raw: string, precision: LodgingDatePrecision): string {
  if (!raw) return "";
  if (precision === "MONTH") return `${raw}-01`;
  if (precision === "YEAR") return `${raw.padStart(4, "0")}-01-01`;
  return raw;
}

export function StayEditor({
  mode,
  lodgingId,
  lodgingChainId = null,
  lodgingCountryCode = null,
  stay,
  onClose,
  onSaved,
  onRequestDelete,
}: StayEditorProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const fid = useId();
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  const [checkIn, setCheckIn] = useState<string>(toDateInput(stay?.checkIn));
  const [checkOut, setCheckOut] = useState<string>(toDateInput(stay?.checkOut));
  // Optional "HH:mm" wall-clock times for the two days above — so a planned
  // hotel does not "begin" at midnight in the Als-Nächstes countdown. Only
  // offered at DAY precision; submit clears them at any other precision.
  const [checkInTime, setCheckInTime] = useState<string>(stay?.checkInTime ?? "");
  const [checkOutTime, setCheckOutTime] = useState<string>(stay?.checkOutTime ?? "");
  // How much of the date the user actually knows. A hotel from 2011 you cannot
  // date is still a place you slept, and rating/price/board all live on the
  // stay — so the alternative to this control was not entering the stay at all.
  const [datePrecision, setDatePrecision] = useState<LodgingDatePrecision>(
    stay?.datePrecision ?? "DAY"
  );
  // Only consulted when the dates cannot supply a length. Kept as text so a
  // half-typed value does not become 0.
  const [nightsText, setNightsText] = useState<string>(
    stay?.nights != null ? String(stay.nights) : ""
  );
  // Cancellation is the ONLY status the user decides, so it is the only one
  // held in state. Keeping a full `status` here is what let the editor save a
  // stale "completed" default while the UI displayed the correctly derived
  // value — the state and the derivation were two answers to one question.
  const [isCancelled, setIsCancelled] = useState<boolean>(stay?.status === "cancelled");
  const [roomNumber, setRoomNumber] = useState<string>(stay?.roomNumber ?? "");
  const [roomCategory, setRoomCategory] = useState<string>(stay?.roomCategory ?? "");
  const [board, setBoard] = useState<BoardType>(stay?.board ?? "none");

  const [ratingRoom, setRatingRoom] = useState<number | null>(stay?.ratingRoom ?? null);
  const [ratingBreakfast, setRatingBreakfast] = useState<number | null>(
    stay?.ratingBreakfast ?? null
  );
  const [ratingService, setRatingService] = useState<number | null>(stay?.ratingService ?? null);

  const [totalPrice, setTotalPrice] = useState<string>(stay?.totalPrice?.toString() ?? "");
  // A NEW stay starts in the currency the bill is most likely written in: the
  // hotel's country first, the account's base currency when the country says
  // nothing. It used to start at a literal "EUR" for every hotel on earth, so
  // a US booking was entered in euros unless the user noticed the dropdown
  // (#320). An EXISTING stay keeps what it was saved with — its currency is a
  // recorded fact, not a suggestion.
  const [currency, setCurrency] = useState<LodgingCurrency>(
    stay?.currency ?? currencyForCountry(lodgingCountryCode) ?? baseCurrency ?? "EUR"
  );
  // Text, not a number: an empty field means "no rate of my own", which is a
  // different thing from 0 and must reach the API as an explicit null.
  const [manualFxRate, setManualFxRate] = useState<string>(
    stay?.fxSource === "manual" && stay.fxRate !== null ? String(stay.fxRate) : ""
  );
  const [isAwardStay, setIsAwardStay] = useState<boolean>(stay?.isAwardStay ?? false);

  const [roomAmenities, setRoomAmenities] = useState<string[]>(stay?.roomAmenities ?? []);
  const [bookingReference, setBookingReference] = useState<string>(stay?.bookingReference ?? "");
  const [membershipId, setMembershipId] = useState<string>(stay?.membershipId ?? "");
  const [membershipOptOut, setMembershipOptOut] = useState<boolean>(
    stay?.membershipOptOut ?? false
  );
  const [showMembershipOverride, setShowMembershipOverride] = useState<boolean>(
    (stay?.membershipId ?? null) !== null || (stay?.membershipOptOut ?? false)
  );
  const [tripId, setTripId] = useState<string>(stay?.tripId ?? "");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(stay?.receiptUrl ?? null);
  const [companionsInput, setCompanionsInput] = useState<string>(
    (stay?.companions ?? []).join(", ")
  );
  const [notes, setNotes] = useState<string>(stay?.notes ?? "");

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

  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

  // Both figures Alex asked to stop being typed (Discord 2026-07-12). Derived
  // on every render rather than held in state, so the value shown and the
  // value saved can never drift apart — a state copy would need an effect to
  // stay in sync, and that effect is exactly where such bugs live.
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
  // The single value the save path sends — no second source to drift from.
  const effectiveStatus: StayStatus = isCancelled ? "cancelled" : derivedStatus;

  const parsedTotalPrice = totalPrice.trim() ? Number.parseFloat(totalPrice) : null;
  const parsedManualFxRate =
    manualFxRate.trim() && Number.isFinite(Number.parseFloat(manualFxRate))
      ? Number.parseFloat(manualFxRate)
      : null;
  // The SAME function the server runs on save (shared/ratingDerivation.ts), so
  // the readout cannot promise a number the backend then stores differently.
  // `current` carries an overall the stay already has with no components behind
  // it — an import, or a row from before the components existed. Without it,
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
  // `membershipId` is an OVERRIDE, never the answer — a card attached to the
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

  // A month input speaks "YYYY-MM" and a year input a bare number, but the
  // column stores a full date either way — the FIRST of the period, marked as
  // a placeholder by `datePrecision`. These two convert between the two
  // vocabularies in one place so the form and the payload cannot disagree.
  const precisionInputValue =
    datePrecision === "MONTH"
      ? checkIn.slice(0, 7)
      : datePrecision === "YEAR"
        ? checkIn.slice(0, 4)
        : checkIn;

  const parsedNights =
    nightsText.trim() && Number.isFinite(Number.parseInt(nightsText, 10))
      ? Math.max(0, Number.parseInt(nightsText, 10))
      : null;

  const submit = async (): Promise<void> => {
    // Only exact dates still demand both ends. Every other precision is a
    // statement that the user does NOT have them, so demanding them would be
    // refusing the very data the field was added for.
    if (datePrecision === "DAY" && (!checkIn || !checkOut)) {
      setError(t("lodging:stayEditor.datesRequired"));
      return;
    }
    if ((datePrecision === "MONTH" || datePrecision === "YEAR") && !checkIn) {
      setError(t("lodging:stayEditor.datesRequired"));
      return;
    }
    if (mode === "edit" && !stay) {
      // Defensive only — callers always pass `stay` in edit mode. Surfaces
      // as a clean error instead of a runtime throw on the cast below.
      setError(t("lodging:stayEditor.saveError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: StayInput = {
        // At NONE precision both dates are cleared outright rather than left
        // as whatever the form last held — a hidden date would be stored and
        // then bucketed as if the user had meant it.
        checkIn: datePrecision === "NONE" ? null : checkIn ? fromDateInput(checkIn) : null,
        checkOut: datePrecision === "DAY" && checkOut ? fromDateInput(checkOut) : null,
        // A time is a claim about a DAY-precise date — anything else clears
        // it, matching the backend's invariant (routes/lodging.ts PATCH).
        checkInTime: datePrecision === "DAY" && checkIn && checkInTime ? checkInTime : null,
        checkOutTime: datePrecision === "DAY" && checkOut && checkOutTime ? checkOutTime : null,
        datePrecision,
        nights: parsedNights,
        status: effectiveStatus,
        // `null` (not `undefined`) for every clearable field below — an
        // omitted key means "leave it alone" to the backend PATCH handler,
        // while an explicit `null` means "delete this value" (finding 4).
        // `undefined` would be dropped by JSON.stringify and read back as
        // "unchanged", so a user could never clear a field once set.
        roomNumber: roomNumber.trim() || null,
        roomCategory: roomCategory.trim() || null,
        board,
        // Derived, not typed — still PERSISTED, because importers, the stats
        // service and the API all read the stored column; only the way the
        // user supplies it changed.
        pricePerNight: derivedPricePerNight,
        currency,
        totalPrice: Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
        // An emptied field is an explicit null — the user taking their rate
        // back — and must not collapse into "leave it alone".
        manualFxRate: parsedManualFxRate,
        // MUST reach the payload unconditionally (including `false`, to let
        // an edit turn an award stay back off) — without this, the four
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
        // Only ever the override — never the derived value. Writing the
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
      let saved: LodgingStay;
      if (mode === "create") {
        saved = await createStay(lodgingId, input);
      } else if (stay) {
        saved = await updateStay(lodgingId, stay.id, input);
      } else {
        // Unreachable — the guard above already returned for this case —
        // but this keeps `stay.id` above type-checked without an assertion.
        return;
      }
      await onSaved(saved);
    } catch (err: unknown) {
      logger.error("StayEditor: save failed", err);
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("lodging:stayEditor.saveError");
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === "create" ? t("lodging:stayEditor.createTitle") : t("lodging:stayEditor.editTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--bg-base)] shadow-xl">
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>

        <div className="p-6">
          <StayEditorSection title={t("lodging:stayEditor.datesSection")}>
            {/* The precision picker comes FIRST because it decides which of the
                fields below make sense. Offering two date inputs and then
                refusing the save is the behaviour this replaces. */}
            <label
              htmlFor={`${fid}-precision`}
              className="mb-1 block text-xs text-[var(--text-muted)]"
            >
              {t("lodging:period.precision.label")}
            </label>
            <select
              id={`${fid}-precision`}
              data-testid="stay-date-precision"
              className={INPUT_CLASS}
              value={datePrecision}
              onChange={(e): void => setDatePrecision(e.target.value as LodgingDatePrecision)}
            >
              {LODGING_DATE_PRECISIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`lodging:period.precision.${p}`)}
                </option>
              ))}
            </select>
            <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
              {t(`lodging:period.precision.${datePrecision}Hint`)}
            </p>

            {datePrecision !== "NONE" && (
              // Named on screen, not by aria-label: two bare native pickers side
              // by side did not say which end was which (CT106 design-6 R06).
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("lodging:field.checkIn")} htmlFor={`${fid}-checkIn`}>
                  <input
                    id={`${fid}-checkIn`}
                    type={
                      datePrecision === "MONTH"
                        ? "month"
                        : datePrecision === "YEAR"
                          ? "number"
                          : "date"
                    }
                    className={INPUT_CLASS}
                    style={DARK_PICKER_STYLE}
                    value={precisionInputValue}
                    onChange={(e): void =>
                      setCheckIn(precisionToIsoDay(e.target.value, datePrecision))
                    }
                  />
                </Field>
                {datePrecision === "DAY" && (
                  <Field label={t("lodging:field.checkOut")} htmlFor={`${fid}-checkOut`}>
                    <input
                      id={`${fid}-checkOut`}
                      type="date"
                      className={INPUT_CLASS}
                      style={DARK_PICKER_STYLE}
                      value={checkOut}
                      onChange={(e): void => setCheckOut(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}
            {tripDates.offer && (
              <StayDatesOfferButton offer={tripDates.offer} onAccept={tripDates.accept} t={t} />
            )}

            {/* Optional times, DAY precision only — mainly so a planned stay's
                "Als Nächstes" countdown points at the real check-in, not at
                midnight. */}
            {datePrecision === "DAY" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field
                  label={t("lodging:field.checkInTime")}
                  htmlFor={`${fid}-checkInTime`}
                  hint={t("lodging:field.checkInTimeHint")}
                >
                  <input
                    id={`${fid}-checkInTime`}
                    type="time"
                    className={INPUT_CLASS}
                    style={DARK_PICKER_STYLE}
                    value={checkInTime}
                    onChange={(e): void => setCheckInTime(e.target.value)}
                  />
                </Field>
                <Field
                  label={t("lodging:field.checkOutTime")}
                  htmlFor={`${fid}-checkOutTime`}
                  hint={t("lodging:field.checkOutTimeHint")}
                >
                  <input
                    id={`${fid}-checkOutTime`}
                    type="time"
                    className={INPUT_CLASS}
                    style={DARK_PICKER_STYLE}
                    value={checkOutTime}
                    onChange={(e): void => setCheckOutTime(e.target.value)}
                  />
                </Field>
              </div>
            )}

            {/* Only asked for where the dates cannot answer it. At DAY
                precision with both ends the dates win anyway, so a field here
                would be a second answer to a settled question. */}
            {datePrecision !== "DAY" && (
              <div className="mt-3">
                <label
                  htmlFor={`${fid}-nights`}
                  className="mb-1 block text-xs text-[var(--text-muted)]"
                >
                  {t("lodging:period.nightsField")}
                </label>
                <input
                  id={`${fid}-nights`}
                  type="number"
                  min={0}
                  data-testid="stay-nights-input"
                  className={INPUT_CLASS}
                  value={nightsText}
                  onChange={(e): void => setNightsText(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("lodging:period.nightsHint")}
                </p>
              </div>
            )}
            {/* Status follows the dates (Alex, Discord 2026-07-12) — the same
                rule 2.5.0 applied to flights, cruises and trips. Only the
                cancellation is a human decision, so only it is a control. The
                derived value is shown so the user can see what will be stored
                rather than having to guess. */}
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  data-testid="stay-cancelled-toggle"
                  checked={isCancelled}
                  onChange={(e): void => setIsCancelled(e.target.checked)}
                />
                {t("lodging:stayStatus.cancelled")}
              </label>
              {!isCancelled && (
                <span
                  data-testid="stay-derived-status"
                  className="text-xs text-[var(--text-muted)]"
                >
                  {t(`lodging:stayStatus.${derivedStatus}`)}
                  {" · "}
                  {t("lodging:stayStatus.derivedHint")}
                </span>
              )}
            </div>
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
          </StayEditorSection>

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
              className="mt-1 text-xs text-[var(--accent)] hover:underline"
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

          {error !== null && (
            <div
              data-testid="stay-editor-error"
              className="mb-3 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
            >
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
          {/* Left of the pair, and outlined rather than filled: it sits in the
              same row as Save without competing with it. The caller asks the
              question — this button only opens it. */}
          {onRequestDelete && (
            <button
              type="button"
              data-testid="stay-editor-delete"
              onClick={onRequestDelete}
              disabled={saving}
              className="mr-auto rounded-md border border-[var(--danger)]/50 px-4 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
            >
              {t("common:buttons.delete")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
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
            disabled={saving}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
          >
            {saving ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
