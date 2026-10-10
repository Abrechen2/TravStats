import Modal from "../Modal";
import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { tripsApi } from "../../lib/api";
import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useSettingsStore } from "../../store/settingsStore";
import type { Booking } from "../../types";
import { logger } from "../../lib/logger";
import SuggestionChips from "../common/SuggestionChips";
import {
  BookingEntriesPicker,
  initialSelection,
  type BookingEntryKind,
  type BookingEntryOption,
  type BookingEntrySelection,
} from "./BookingEntriesPicker";

/**
 * A flight of the booking's trip. GET /trips/:id sends the whole flight row;
 * these are the two fields read here, optional because the trip type's flight
 * Pick does not declare the reference.
 */
export interface PnrSource {
  bookingId?: string | null;
  bookingReference?: string | null;
}

const PNR_SUGGESTION_CAP = 4;

/**
 * Booking references the trip's flights carry, those of this booking's own
 * flights first — a PNR typed once on a flight (or parsed off its boarding
 * pass) should not have to be typed again on the booking that paid for it.
 */
export function pnrSuggestions(bookingId: string, flights: readonly PnrSource[]): string[] {
  const ordered = [
    ...flights.filter((f) => f.bookingId === bookingId),
    ...flights.filter((f) => f.bookingId !== bookingId),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of ordered) {
    const value = f.bookingReference?.trim() ?? "";
    if (!value || seen.has(value.toUpperCase())) continue;
    seen.add(value.toUpperCase());
    out.push(value);
  }
  return out.slice(0, PNR_SUGGESTION_CAP);
}

const NO_ENTRIES: Record<BookingEntryKind, BookingEntryOption[]> = {
  flightIds: [],
  stayIds: [],
  cruiseIds: [],
};

interface BookingEditModalProps {
  /** The booking to edit; null creates a package booking on `tripId` (#356). */
  booking: Booking | null;
  tripId?: string;
  /** The trip's flights, for the PNR chips; without them nothing is offered. */
  flights?: readonly PnrSource[];
  /** The trip's flights, stays and cruises the booking may cover (#356). */
  entries?: Record<BookingEntryKind, BookingEntryOption[]>;
  onClose: () => void;
  onSaved: () => void;
}

function sameSelection(a: BookingEntrySelection, b: BookingEntrySelection): boolean {
  const same = (x: string[], y: string[]): boolean =>
    x.length === y.length && x.every((id) => y.includes(id));
  return (
    same(a.flightIds, b.flightIds) && same(a.stayIds, b.stayIds) && same(a.cruiseIds, b.cruiseIds)
  );
}

const parseTravellers = (raw: string): number | null => {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
};

export default function BookingEditModal({
  booking,
  tripId,
  flights = [],
  entries = NO_ENTRIES,
  onClose,
  onSaved,
}: BookingEditModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "errors", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [pnr, setPnr] = useState(booking?.pnr ?? "");
  const [operator, setOperator] = useState(booking?.operator ?? "");
  const [price, setPrice] = useState(booking?.price != null ? String(booking.price) : "");
  const [travellers, setTravellers] = useState(
    booking?.travellers != null ? String(booking.travellers) : ""
  );
  const [bookedOn, setBookedOn] = useState(booking?.bookedOn?.slice(0, 10) ?? "");
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  // A booking with no currency on record starts in the account's own
  // currency, not a literal EUR; a stored one is a fact and stays.
  const [currency, setCurrency] = useState(booking?.currency ?? baseCurrency ?? "EUR");
  const recentCurrencies = useRecentCurrencies();
  const [opened] = useState(() => initialSelection(entries, booking?.id ?? null));
  const [selection, setSelection] = useState(opened);
  const [saving, setSaving] = useState(false);
  const travellersInvalid = travellers.trim() !== "" && parseTravellers(travellers) === null;

  const handleSave = async (): Promise<void> => {
    if (travellersInvalid) return;
    setSaving(true);
    const parsedPrice = price.trim() === "" ? null : Number(price);
    const fields = {
      pnr: pnr.trim() === "" ? null : pnr.trim(),
      operator: operator.trim() === "" ? null : operator.trim(),
      price: parsedPrice != null && Number.isFinite(parsedPrice) ? parsedPrice : null,
      currency,
      travellers: parseTravellers(travellers),
      bookedOn: bookedOn || null,
    };
    let stored: Booking | null = booking;
    try {
      if (booking) {
        stored = await tripsApi.updateBooking(booking.id, fields);
      } else {
        stored = await tripsApi.createBooking({
          tripId,
          pnr: fields.pnr ?? undefined,
          operator: fields.operator ?? undefined,
          price: fields.price ?? undefined,
          currency,
          travellers: fields.travellers ?? undefined,
          bookedOn: fields.bookedOn ?? undefined,
          ...selection,
        });
      }
    } catch (err) {
      logger.error("Failed to save booking", err);
      addToast("error", t("errors:generic"));
      setSaving(false);
      return;
    }
    // The entries are a second request on an edit. Its failure is reported as
    // itself: the booking IS saved, only the ticked entries are not filed.
    // Only when the ticks changed — an untouched list is not a request.
    if (booking && stored && !sameSelection(opened, selection)) {
      try {
        await tripsApi.setBookingEntries(stored.id, selection);
      } catch (err) {
        logger.error("Failed to file booking entries", err);
        addToast("error", t("trips:bookingEdit.entriesFailed"));
        setSaving(false);
        onSaved();
        return;
      }
    }
    addToast("success", t(booking ? "trips:bookingEdit.saved" : "trips:bookingEdit.created"));
    setSaving(false);
    onSaved();
  };

  const label = (key: string, control: JSX.Element, extra?: JSX.Element): JSX.Element => (
    <label className="block text-sm">
      <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
        {t(`trips:bookingEdit.${key}`)}
      </span>
      {control}
      {extra}
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      title={t(booking ? "trips:bookingEdit.title" : "trips:bookingEdit.createTitle")}
      maxWidth={448}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={onClose}
            disabled={saving}
          >
            {t("trips:bookingEdit.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => void handleSave()}
            disabled={saving || travellersInvalid}
          >
            {t("trips:bookingEdit.save")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {label(
          "operator",
          <input
            className="input"
            value={operator}
            maxLength={120}
            onChange={(e) => setOperator(e.target.value)}
          />
        )}
        {label(
          "pnr",
          <input
            className="input"
            value={pnr}
            maxLength={20}
            onChange={(e) => setPnr(e.target.value)}
          />,
          <SuggestionChips
            value={pnr}
            suggestions={pnrSuggestions(booking?.id ?? "", flights)}
            onPick={setPnr}
            fieldLabel={t("trips:bookingEdit.pnr")}
          />
        )}
        {label(
          "bookedOn",
          <input
            className="input"
            type="date"
            value={bookedOn}
            onChange={(e) => setBookedOn(e.target.value)}
          />,
          <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
            {t("trips:bookingEdit.bookedOnHint")}
          </span>
        )}
        {label(
          "price",
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        )}
        {label(
          "currency",
          <CurrencySelect value={currency} onChange={setCurrency} recent={recentCurrencies} />
        )}
        {label(
          "travellers",
          <input
            className="input"
            type="number"
            min="1"
            max="50"
            step="1"
            value={travellers}
            aria-invalid={travellersInvalid}
            onChange={(e) => setTravellers(e.target.value)}
          />,
          travellersInvalid ? (
            <span role="alert" className="mt-1 block text-xs" style={{ color: "var(--danger)" }}>
              {t("trips:bookingEdit.travellersInvalid")}
            </span>
          ) : undefined
        )}
        <BookingEntriesPicker
          options={entries}
          value={selection}
          onChange={setSelection}
          bookingId={booking?.id ?? null}
        />
      </div>
    </Modal>
  );
}
