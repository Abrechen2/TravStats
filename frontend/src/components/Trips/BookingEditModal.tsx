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

interface BookingEditModalProps {
  booking: Booking;
  /** The trip's flights, for the PNR chips; without them nothing is offered. */
  flights?: readonly PnrSource[];
  onClose: () => void;
  onSaved: () => void;
}

export default function BookingEditModal({
  booking,
  flights = [],
  onClose,
  onSaved,
}: BookingEditModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "errors", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [pnr, setPnr] = useState(booking.pnr ?? "");
  const [price, setPrice] = useState(booking.price != null ? String(booking.price) : "");
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  // A booking with no currency on record starts in the account's own
  // currency, not a literal EUR; a stored one is a fact and stays.
  const [currency, setCurrency] = useState(booking.currency ?? baseCurrency ?? "EUR");
  const recentCurrencies = useRecentCurrencies();
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const parsedPrice = price.trim() === "" ? null : Number(price);
      await tripsApi.updateBooking(booking.id, {
        pnr: pnr.trim() === "" ? null : pnr.trim(),
        price: parsedPrice != null && Number.isFinite(parsedPrice) ? parsedPrice : null,
        currency,
      });
      addToast("success", t("trips:bookingEdit.saved"));
      onSaved();
    } catch (err) {
      logger.error("Failed to update booking", err);
      addToast("error", t("errors:generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      title={t("trips:bookingEdit.title")}
      maxWidth={384}
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
            disabled={saving}
          >
            {t("trips:bookingEdit.save")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
            {t("trips:bookingEdit.pnr")}
          </span>
          <input
            className="input"
            value={pnr}
            maxLength={20}
            onChange={(e) => setPnr(e.target.value)}
          />
          <SuggestionChips
            value={pnr}
            suggestions={pnrSuggestions(booking.id, flights)}
            onPick={setPnr}
            fieldLabel={t("trips:bookingEdit.pnr")}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
            {t("trips:bookingEdit.price")}
          </span>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
            {t("trips:bookingEdit.currency")}
          </span>
          <CurrencySelect value={currency} onChange={setCurrency} recent={recentCurrencies} />
        </label>
      </div>
    </Modal>
  );
}
