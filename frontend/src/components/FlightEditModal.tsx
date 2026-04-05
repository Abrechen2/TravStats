import { useState, useEffect } from "react";
import type { Flight } from "../types";
import ReceiptUpload from "./ReceiptUpload";
import { useTranslation } from "../hooks/useTranslation";
import { AIRLINES } from "../lib/constants";

interface FlightEditModalProps {
  flight: Flight;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Flight>) => Promise<void>;
}

export default function FlightEditModal({
  flight,
  isOpen,
  onClose,
  onSave,
}: FlightEditModalProps): JSX.Element | null {
  const { t } = useTranslation(["flights", "common", "errors"]);
  const [formData, setFormData] = useState({
    airline: flight.airline || "",
    operatingAirline: flight.operatingAirline || "",
    flightNumber: flight.flightNumber || "",
    aircraft: flight.aircraft || "",
    status: flight.status || "scheduled",
    category: flight.category || "",
    seatClass: flight.seatClass || "",
    seatNumber: flight.seatNumber || "",
    price: flight.price || 0,
    currency: flight.currency || "EUR",
    taxes: flight.taxes || 0,
    fees: flight.fees || 0,
    notes: flight.notes || "",
    tags: flight.tags?.join(", ") || "",
    receiptUrl: flight.receiptUrl || "",
    actualDeparture: flight.actualDeparture
      ? new Date(flight.actualDeparture).toISOString().slice(0, 16)
      : "",
    actualArrival: flight.actualArrival
      ? new Date(flight.actualArrival).toISOString().slice(0, 16)
      : "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Reset form when flight changes
    setFormData({
      airline: flight.airline || "",
      operatingAirline: flight.operatingAirline || "",
      flightNumber: flight.flightNumber || "",
      aircraft: flight.aircraft || "",
      status: flight.status || "scheduled",
      category: flight.category || "",
      seatClass: flight.seatClass || "",
      seatNumber: flight.seatNumber || "",
      price: flight.price || 0,
      currency: flight.currency || "EUR",
      taxes: flight.taxes || 0,
      fees: flight.fees || 0,
      notes: flight.notes || "",
      tags: flight.tags?.join(", ") || "",
      receiptUrl: flight.receiptUrl || "",
      actualDeparture: flight.actualDeparture
        ? new Date(flight.actualDeparture).toISOString().slice(0, 16)
        : "",
      actualArrival: flight.actualArrival
        ? new Date(flight.actualArrival).toISOString().slice(0, 16)
        : "",
    });
    setError("");
  }, [flight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const updates: Partial<Flight> = {
        airline: formData.airline || undefined,
        operatingAirline: formData.operatingAirline || undefined,
        flightNumber: formData.flightNumber || undefined,
        aircraft: formData.aircraft || undefined,
        status: formData.status as Flight["status"],
        category: (formData.category || undefined) as Flight["category"],
        seatClass: (formData.seatClass || undefined) as Flight["seatClass"],
        seatNumber: formData.seatNumber || undefined,
        price: formData.price > 0 ? formData.price : undefined,
        currency: formData.currency as Flight["currency"],
        taxes: formData.taxes > 0 ? formData.taxes : undefined,
        fees: formData.fees > 0 ? formData.fees : undefined,
        notes: formData.notes || undefined,
        tags: formData.tags
          ? formData.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        receiptUrl: formData.receiptUrl || undefined,
        actualDeparture: formData.actualDeparture
          ? new Date(formData.actualDeparture).toISOString()
          : undefined,
        actualArrival: formData.actualArrival
          ? new Date(formData.actualArrival).toISOString()
          : undefined,
      };

      await onSave(flight.id, updates);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errors:updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
      <div
        className="rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg-surface)" }}
      >
        <div
          className="sticky top-0 px-6 py-4"
          style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              {t("flights:edit.title")}
            </h2>
            <button
              onClick={onClose}
              className="transition-colors"
              style={{ color: "var(--text-muted)" }}
              aria-label={t("common:buttons.close")}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {flight.depIata || flight.depIcao} {t("common:labels.routeSeparator")}{" "}
            {flight.arrIata || flight.arrIcao}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">{t("flights:form.airline")}</label>
              <input
                type="text"
                value={formData.airline}
                onChange={(e) => setFormData({ ...formData, airline: e.target.value })}
                className="input"
                placeholder={t("flights:form.placeholders.airline")}
                list="airline-suggestions-edit"
              />
              <datalist id="airline-suggestions-edit">
                {AIRLINES.map((a) => (
                  <option key={a.iata} value={a.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label">{t("flights:form.operatingAirline")}</label>
              <input
                type="text"
                value={formData.operatingAirline}
                onChange={(e) => setFormData({ ...formData, operatingAirline: e.target.value })}
                className="input"
                placeholder="z.B. Eurowings, Deutsche Bahn…"
                list="operating-airline-suggestions-edit"
              />
              <datalist id="operating-airline-suggestions-edit">
                {AIRLINES.map((a) => (
                  <option key={a.iata} value={a.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label">{t("flights:form.flightNumber")}</label>
              <input
                type="text"
                value={formData.flightNumber}
                onChange={(e) => setFormData({ ...formData, flightNumber: e.target.value })}
                className="input"
                placeholder={t("flights:form.placeholders.flightNumber")}
              />
            </div>
          </div>

          <div>
            <label className="label">{t("flights:form.aircraft")}</label>
            <input
              type="text"
              value={formData.aircraft}
              onChange={(e) => setFormData({ ...formData, aircraft: e.target.value })}
              className="input"
              placeholder={t("flights:form.placeholders.aircraft")}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">{t("flights:form.status")}</label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.value as "scheduled" | "flown" | "cancelled",
                  })
                }
                className="input"
              >
                <option value="scheduled">{t("flights:status.scheduled")}</option>
                <option value="flown">{t("flights:status.flown")}</option>
                <option value="cancelled">{t("flights:status.cancelled")}</option>
              </select>
            </div>

            <div>
              <label className="label">{t("flights:form.category")}</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input"
              >
                <option value="">{t("common:labels.optional")}</option>
                <option value="business">{t("flights:category.business")}</option>
                <option value="private">{t("flights:category.private")}</option>
                <option value="vacation">{t("flights:category.vacation")}</option>
              </select>
            </div>

            <div>
              <label className="label">{t("flights:form.seatClass")}</label>
              <select
                value={formData.seatClass}
                onChange={(e) => setFormData({ ...formData, seatClass: e.target.value })}
                className="input"
              >
                <option value="">{t("common:labels.optional")}</option>
                <option value="economy">{t("flights:seatClass.economy")}</option>
                <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
                <option value="business">{t("flights:seatClass.business")}</option>
                <option value="first">{t("flights:seatClass.first")}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">{t("flights:form.seat")}</label>
            <input
              type="text"
              value={formData.seatNumber}
              onChange={(e) => setFormData({ ...formData, seatNumber: e.target.value })}
              className="input"
              placeholder={t("flights:form.placeholders.seat")}
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="label">{t("common:labels.price")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
                }
                className="input"
                placeholder={t("flights:form.placeholders.price")}
              />
            </div>

            <div>
              <label className="label">{t("flights:form.currency")}</label>
              <select
                value={formData.currency}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    currency: e.target.value as "EUR" | "USD" | "GBP" | "CHF",
                  })
                }
                className="input"
              >
                <option value="EUR">{t("flights:currency.EUR")}</option>
                <option value="USD">{t("flights:currency.USD")}</option>
                <option value="GBP">{t("flights:currency.GBP")}</option>
                <option value="CHF">{t("flights:currency.CHF")}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t("common:labels.taxes")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.taxes}
                onChange={(e) =>
                  setFormData({ ...formData, taxes: parseFloat(e.target.value) || 0 })
                }
                className="input"
                placeholder={t("flights:form.placeholders.taxes")}
              />
            </div>

            <div>
              <label className="label">{t("common:labels.fees")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.fees}
                onChange={(e) =>
                  setFormData({ ...formData, fees: parseFloat(e.target.value) || 0 })
                }
                className="input"
                placeholder={t("flights:form.placeholders.fees")}
              />
            </div>
          </div>

          <div>
            <label className="label">{t("flights:form.tags")}</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              className="input"
              placeholder={t("flights:form.placeholders.tags")}
            />
          </div>

          {/* Actual Times — Phase 3 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="actualDeparture">
                {t("flights:actualTimes.actualDeparture")}
              </label>
              <input
                id="actualDeparture"
                type="datetime-local"
                className="input"
                value={formData.actualDeparture}
                onChange={(e) => setFormData({ ...formData, actualDeparture: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="actualArrival">
                {t("flights:actualTimes.actualArrival")}
              </label>
              <input
                id="actualArrival"
                type="datetime-local"
                className="input"
                value={formData.actualArrival}
                onChange={(e) => setFormData({ ...formData, actualArrival: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">{t("common:labels.notes")}</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input"
              rows={3}
              placeholder={t("flights:form.placeholders.notes")}
            />
          </div>

          <ReceiptUpload
            currentReceiptUrl={formData.receiptUrl}
            onUploadSuccess={(receiptUrl) => setFormData({ ...formData, receiptUrl })}
            onDelete={() => setFormData({ ...formData, receiptUrl: "" })}
          />

          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? t("common:buttons.saving") : t("flights:edit.saveChanges")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              {t("common:buttons.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
