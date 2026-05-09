import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Trip } from "../../types";
import TripCard from "./TripCard";
import TripModal from "./TripModal";
import DetectTripsBanner from "./DetectTripsBanner";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

// Card click → /trips/:id (detail page). The legacy "show on map" handler
// pushed `visMode: "trip-routes"` to `/`, which never matched the dashboard
// MapMode union — left over from before trips had their own page.

interface TripsTabProps {
  trips: Trip[];
  onTripsChange: () => void;
}

export default function TripsTab({ trips, onTripsChange }: TripsTabProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null);

  const handleDelete = async (trip: Trip): Promise<void> => {
    setDeleteTarget(trip);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await tripsApi.delete(deleteTarget.id);
      addToast("success", t("trips:toasts.deleted"));
      setDeleteTarget(null);
      onTripsChange();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
      setDeleteTarget(null);
    }
  };

  const handleOpen = (trip: Trip): void => {
    navigate(`/trips/${trip.id}`);
  };

  return (
    <div className="p-4">
      <DetectTripsBanner onChange={onTripsChange} />
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {t("trips:count", { count: trips.length })}
        </p>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          ＋ {t("trips:createTrip")}
        </button>
      </div>

      {trips.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-2xl mb-2">🗺</p>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("trips:noTrips")}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("trips:noTripsDesc")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onOpen={handleOpen}
              onEdit={setEditingTrip}
              onDelete={(tripToDelete) => void handleDelete(tripToDelete)}
            />
          ))}
          {/* New trip placeholder card */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-xl border border-dashed flex flex-col items-center justify-center min-h-[200px] gap-2 transition-colors hover:border-[var(--accent)]/50"
            style={{ borderColor: "var(--color-border)", background: "var(--bg-muted)" }}
          >
            <span className="text-3xl opacity-20">＋</span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("trips:newTrip")}
            </span>
            <span
              className="text-xs text-center px-4"
              style={{ color: "var(--text-muted)", opacity: 0.6 }}
            >
              {t("trips:newTripDesc")}
            </span>
          </button>
        </div>
      )}

      {(showCreateModal || editingTrip !== null) && (
        <TripModal
          trip={editingTrip}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTrip(null);
          }}
          onSaved={() => {
            setShowCreateModal(false);
            setEditingTrip(null);
            onTripsChange();
          }}
        />
      )}

      {deleteTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-4"
            role="dialog"
            aria-modal="true"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("trips:deleteTripConfirm", { name: deleteTarget.name })}
            </h2>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {t("trips:modal.cancel")}
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--color-error, #f87171)", color: "#fff" }}
              >
                {t("trips:deleteTrip")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
