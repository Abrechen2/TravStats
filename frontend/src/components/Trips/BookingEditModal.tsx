import Modal from "../Modal";
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
  const { t } = useTranslation(["trips", "errors", "common"]);
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
    </Modal>
  );
}
