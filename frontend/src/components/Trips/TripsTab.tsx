import { useState } from "react";
import type { Trip } from "../../types";
import TripCard from "./TripCard";
import TripModal from "./TripModal";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface TripsTabProps {
  trips: Trip[];
  onTripsChange: () => void;
}

export default function TripsTab({ trips, onTripsChange }: TripsTabProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleDelete = async (trip: Trip) => {
    if (!window.confirm(t("trips:deleteTripConfirm", { name: trip.name }))) return;
    try {
      await tripsApi.delete(trip.id);
      addToast("success", t("trips:toasts.deleted"));
      onTripsChange();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
    }
  };

  const handleShowOnMap = (_trip: Trip) => {
    // Map trip-routes layer will be added in Task 11
  };

  return (
    <div className="p-4">
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
              onEdit={setEditingTrip}
              onDelete={(tripToDelete) => void handleDelete(tripToDelete)}
              onShowOnMap={handleShowOnMap}
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
    </div>
  );
}
