import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useToastStore } from "../../store/toastStore";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { formatAmount } from "../../lib/units";
import { formatLocalDate } from "../../lib/displayFormat";
import type { Booking, Trip } from "../../types";
import BookingEditModal from "./BookingEditModal";
import type { BookingEntryKind, BookingEntryOption } from "./BookingEntriesPicker";
import { PanelHeader } from "./TripDetailPanels";
import { RowActionButton } from "../table/RowActionButton";

interface Props {
  trip: Trip;
  language: string | undefined;
  onChanged: () => void;
  /** Labels for the trip's flights and cruises, as the logistics tables print their day. */
  flightDay: (f: NonNullable<Trip["flights"]>[number]) => string;
  cruiseDay: (c: NonNullable<Trip["cruises"]>[number]) => string;
}

/** The trip's flights, stays and cruises, as a package booking can cover them. */
export function bookingEntryOptions(
  trip: Trip,
  flightDay: Props["flightDay"],
  cruiseDay: Props["cruiseDay"]
): Record<BookingEntryKind, BookingEntryOption[]> {
  return {
    flightIds: (trip.flights ?? []).map((f) => ({
      id: f.id,
      label: `${flightDay(f)} · ${f.depIata ?? "???"} → ${f.arrIata ?? "???"}`,
      bookingId: f.bookingId,
    })),
    stayIds: (trip.lodgingStays ?? []).map((s) => ({
      id: s.id,
      label: `${s.checkIn ? formatLocalDate(s.checkIn.slice(0, 10)) : "—"} · ${s.lodging.name}`,
      bookingId: s.bookingId,
    })),
    cruiseIds: (trip.cruises ?? []).map((c) => ({
      id: c.id,
      label: `${cruiseDay(c)} · ${c.routeName ?? c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "—"}`,
      bookingId: c.bookingId,
    })),
  };
}

/**
 * The trip's package bookings (#356): operator, booking number and the one
 * price the package cost, "für N Personen" where the booking says how many —
 * and a way to create one by hand, pick the flights, stays and cruises it
 * covers, and delete it again. Deleting keeps the entries; they only stop
 * belonging to the booking.
 *
 * No subtotal: a client sum of the booking list could differ from the trip's
 * cost the overview shows — the server's figure, which counts trains, rentals
 * and expenses and a booking only on the trip its segments are on
 * (forgejo#274 review M8).
 */
export function TripBookingsPanel({
  trip,
  language,
  onChanged,
  flightDay,
  cruiseDay,
}: Props): JSX.Element {
  const { t } = useTranslation(["trips", "errors"]);
  const addToast = useToastStore((s) => s.addToast);
  const { confirm, confirmDialog } = useConfirmDialog();
  const bookings = trip.bookings ?? [];
  const [editing, setEditing] = useState<Booking | "new" | null>(null);

  const remove = async (b: Booking): Promise<void> => {
    if (!(await confirm({ message: t("trips:bookingEdit.deleteConfirm"), destructive: true }))) {
      return;
    }
    try {
      await tripsApi.deleteBooking(b.id);
      addToast("success", t("trips:bookingEdit.deleted"));
      onChanged();
    } catch (err) {
      logger.error("Failed to delete booking", err);
      addToast("error", t("errors:generic"));
    }
  };

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid="trip-bookings"
    >
      <PanelHeader>
        {t("trips:detail.logistics.bookings")} ({bookings.length})
      </PanelHeader>
      {bookings.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              <th className="text-left px-4 py-2">{t("trips:bookingEdit.operator")}</th>
              <th className="text-left px-4 py-2">{t("trips:bookingEdit.pnr")}</th>
              <th className="text-right px-4 py-2">{t("trips:bookingEdit.price")}</th>
              <th className="text-right px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="px-4 py-2.5">{b.operator ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono">{b.pnr ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {b.price != null ? formatAmount(b.price, b.currency, { language }) : "—"}
                  {b.price != null && b.travellers != null && (
                    <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("trips:bookingEdit.forPersons", { count: b.travellers })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <RowActionButton
                    icon="edit"
                    label={t("trips:bookingEdit.title")}
                    onClick={() => setEditing(b)}
                  />
                  <RowActionButton
                    icon="delete"
                    label={t("trips:bookingEdit.delete")}
                    onClick={() => void remove(b)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          type="button"
          className="text-sm"
          style={{ color: "var(--accent)" }}
          onClick={() => setEditing("new")}
        >
          {t("trips:bookingEdit.add")}
        </button>
      </div>

      {editing && (
        <BookingEditModal
          booking={editing === "new" ? null : editing}
          tripId={trip.id}
          flights={trip.flights ?? []}
          entries={bookingEntryOptions(trip, flightDay, cruiseDay)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
