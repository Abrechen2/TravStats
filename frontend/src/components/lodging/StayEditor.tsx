import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { createStay, updateStay, listMemberships } from "../../lib/api/lodging";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import ReceiptUpload from "../ReceiptUpload";
import { AmenityChipsInput } from "./AmenityChipsInput";
import { StayEditorRatingsSection } from "./StayEditorRatingsSection";
import { StayEditorPriceSection } from "./StayEditorPriceSection";
import { averageStayRating, derivePricePerNight } from "../../lib/lodgingFormat";
import { MembershipManager } from "./MembershipManager";
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
  stay?: LodgingStay | null;
  onClose: () => void;
  onSaved: (saved: LodgingStay) => void | Promise<void>;
}

const BOARD_TYPES: BoardType[] = ["none", "breakfast", "half", "full", "all_inclusive"];
const STAY_STATUSES: StayStatus[] = ["scheduled", "completed", "cancelled"];

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
 * `<Section>` blocks). Star pickers and the price/FX block are extracted
 * into their own files to keep this one under the project's file-size limit.
 */
export function StayEditor({ mode, lodgingId, stay, onClose, onSaved }: StayEditorProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  const [checkIn, setCheckIn] = useState<string>(toDateInput(stay?.checkIn));
  const [checkOut, setCheckOut] = useState<string>(toDateInput(stay?.checkOut));
  const [status, setStatus] = useState<StayStatus>(stay?.status ?? "completed");
  const [roomNumber, setRoomNumber] = useState<string>(stay?.roomNumber ?? "");
  const [roomCategory, setRoomCategory] = useState<string>(stay?.roomCategory ?? "");
  const [board, setBoard] = useState<BoardType>(stay?.board ?? "none");

  const [ratingRoom, setRatingRoom] = useState<number | null>(stay?.ratingRoom ?? null);
  const [ratingBreakfast, setRatingBreakfast] = useState<number | null>(stay?.ratingBreakfast ?? null);
  const [ratingService, setRatingService] = useState<number | null>(stay?.ratingService ?? null);

  const [totalPrice, setTotalPrice] = useState<string>(stay?.totalPrice?.toString() ?? "");
  const [currency, setCurrency] = useState<LodgingCurrency>(stay?.currency ?? "EUR");
  const [isAwardStay, setIsAwardStay] = useState<boolean>(stay?.isAwardStay ?? false);

  const [roomAmenities, setRoomAmenities] = useState<string[]>(stay?.roomAmenities ?? []);
  const [bookingReference, setBookingReference] = useState<string>(stay?.bookingReference ?? "");
  const [membershipId, setMembershipId] = useState<string>(stay?.membershipId ?? "");
  const [tripId, setTripId] = useState<string>(stay?.tripId ?? "");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(stay?.receiptUrl ?? null);
  const [companionsInput, setCompanionsInput] = useState<string>((stay?.companions ?? []).join(", "));
  const [notes, setNotes] = useState<string>(stay?.notes ?? "");

  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);
  const [showMembershipManager, setShowMembershipManager] = useState<boolean>(false);
  const [trips, setTrips] = useState<Trip[]>([]);

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
  const parsedTotalPrice = totalPrice.trim() ? Number.parseFloat(totalPrice) : null;
  const derivedRatingOverall = averageStayRating(ratingRoom, ratingBreakfast, ratingService);
  const derivedPricePerNight = derivePricePerNight(
    Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
    checkIn,
    checkOut
  );

  const submit = async (): Promise<void> => {
    if (!checkIn || !checkOut) {
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
        checkIn: fromDateInput(checkIn),
        checkOut: fromDateInput(checkOut),
        status,
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
        membershipId: membershipId || null,
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

  const title = mode === "create" ? t("lodging:stayEditor.createTitle") : t("lodging:stayEditor.editTitle");

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
          <Section title={t("lodging:stayEditor.datesSection")}>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                aria-label={t("lodging:field.checkIn")}
                className={INPUT_CLASS}
                style={DARK_PICKER_STYLE}
                value={checkIn}
                onChange={(e): void => setCheckIn(e.target.value)}
              />
              <input
                type="date"
                aria-label={t("lodging:field.checkOut")}
                className={INPUT_CLASS}
                style={DARK_PICKER_STYLE}
                value={checkOut}
                onChange={(e): void => setCheckOut(e.target.value)}
              />
            </div>
            <select
              aria-label={t("lodging:field.status")}
              className={`mt-3 ${INPUT_CLASS}`}
              value={status}
              onChange={(e): void => setStatus(e.target.value as StayStatus)}
            >
              {STAY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`lodging:stayStatus.${s}`)}
                </option>
              ))}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input
                aria-label={t("lodging:field.room")}
                className={INPUT_CLASS}
                value={roomNumber}
                onChange={(e): void => setRoomNumber(e.target.value)}
                placeholder={t("lodging:field.room")}
              />
              <input
                aria-label={t("lodging:field.roomCategory")}
                className={INPUT_CLASS}
                value={roomCategory}
                onChange={(e): void => setRoomCategory(e.target.value)}
                placeholder={t("lodging:field.roomCategory")}
              />
            </div>
          </Section>

          <Section title={t("lodging:field.board")}>
            <div
              className="inline-flex flex-wrap rounded-lg p-0.5"
              style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
              role="group"
              aria-label={t("lodging:field.board")}
            >
              {BOARD_TYPES.map((b) => {
                const active = b === board;
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={active}
                    onClick={(): void => setBoard(b)}
                    className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                    style={{
                      background: active ? "var(--accent)" : "transparent",
                      color: active ? "#1a1205" : "var(--text-secondary)",
                    }}
                  >
                    {t(`lodging:board.${b}`)}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={t("lodging:stayEditor.ratingsSection")}>
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
          </Section>

          <Section title={t("lodging:stayEditor.priceSection")}>
            <StayEditorPriceSection
              totalPrice={totalPrice}
              onTotalPriceChange={setTotalPrice}
              pricePerNight={derivedPricePerNight}
              pricePerNightLabel={t("lodging:field.pricePerNight")}
              currency={currency}
              onCurrencyChange={setCurrency}
              isAwardStay={isAwardStay}
              onAwardStayChange={setIsAwardStay}
              checkInDate={checkIn}
              baseCurrency={baseCurrency}
              language={i18n.language}
              t={t}
              inputClassName={INPUT_CLASS}
            />
          </Section>

          <Section title={t("lodging:stayEditor.amenitiesSection")}>
            <AmenityChipsInput
              label={t("lodging:field.roomAmenities")}
              values={roomAmenities}
              onChange={setRoomAmenities}
              placeholder={t("lodging:field.roomAmenitiesPlaceholder")}
            />
            <input
              aria-label={t("lodging:field.bookingReference")}
              className={`mt-3 ${INPUT_CLASS}`}
              value={bookingReference}
              onChange={(e): void => setBookingReference(e.target.value)}
              placeholder={t("lodging:field.bookingReference")}
            />
          </Section>

          <Section title={t("lodging:stayEditor.loyaltySection")}>
            <div className="flex items-center gap-2">
              <select
                aria-label={t("lodging:field.membership")}
                className={INPUT_CLASS}
                value={membershipId}
                onChange={(e): void => setMembershipId(e.target.value)}
              >
                <option value="">{t("lodging:field.noMembership")}</option>
                {memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.programName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={(): void => setShowMembershipManager((v) => !v)}
                className="whitespace-nowrap rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--bg-surface)]"
              >
                {t("lodging:stayEditor.manageMemberships")}
              </button>
            </div>
            {showMembershipManager && (
              <div className="mt-3">
                <MembershipManager onChanged={setMemberships} />
              </div>
            )}
            <select
              aria-label={t("lodging:field.trip")}
              className={`mt-3 ${INPUT_CLASS}`}
              value={tripId}
              onChange={(e): void => setTripId(e.target.value)}
            >
              <option value="">{t("lodging:field.noTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </Section>

          <Section title={t("lodging:stayEditor.receiptSection")}>
            <ReceiptUpload
              currentReceiptUrl={receiptUrl}
              onUploadSuccess={(url): void => setReceiptUrl(url)}
              onDelete={(): void => setReceiptUrl(null)}
            />
          </Section>

          <Section title={t("lodging:stayEditor.notesSection")}>
            <input
              aria-label={t("lodging:field.companions")}
              className={INPUT_CLASS}
              value={companionsInput}
              onChange={(e): void => setCompanionsInput(e.target.value)}
              placeholder={t("lodging:field.companions")}
            />
            <textarea
              aria-label={t("lodging:field.notes")}
              rows={3}
              className={`mt-3 ${INPUT_CLASS}`}
              value={notes}
              onChange={(e): void => setNotes(e.target.value)}
              placeholder={t("lodging:field.notes")}
            />
          </Section>

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

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <details
      open
      className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)]/50 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
