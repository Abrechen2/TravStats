import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { tripsApi } from "../../lib/api";
import CurrencyInput from "../CurrencyInput";
import type { Booking } from "../../types";
import { logger } from "../../lib/logger";

interface BookingEditModalProps {
  booking: Booking;
  onClose: () => void;
  onSaved: () => void;
}

export default function BookingEditModal({
  booking,
  onClose,
  onSaved,
}: BookingEditModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "errors"]);
  const addToast = useToastStore((s) => s.addToast);
  const [pnr, setPnr] = useState(booking.pnr ?? "");
  const [price, setPrice] = useState(booking.price != null ? String(booking.price) : "");
  const [currency, setCurrency] = useState(booking.currency ?? "EUR");
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <h2 className="mb-4 text-base font-semibold">{t("trips:bookingEdit.title")}</h2>
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
            <CurrencyInput value={currency} onChange={setCurrency} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
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
        </div>
      </div>
    </div>
  );
}
