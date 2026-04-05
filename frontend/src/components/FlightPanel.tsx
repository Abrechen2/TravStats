import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Flight } from "../types";
import { groupFlights } from "../utils/groupFlights";
import { FlightEntry } from "./FlightPanel/FlightEntry";
import { FlightGroupItem } from "./FlightPanel/FlightGroupItem";
import { useTranslation } from "../hooks/useTranslation";

interface FlightPanelProps {
  flights: Flight[];
  totalCount: number;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
  onAddFlight: () => void;
}

export function FlightPanel({
  flights,
  totalCount,
  isOpen,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onAddFlight,
}: FlightPanelProps): JSX.Element {
  const { t } = useTranslation(["dashboard", "common"]);
  const groups = useMemo(() => groupFlights(flights), [flights]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
          <motion.div
            initial={{ x: -380 }}
            animate={{ x: 0 }}
            exit={{ x: -380 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-14 bottom-0 w-80 z-40 flex flex-col overflow-hidden"
            style={{
              background: "rgba(22,27,34,0.95)",
              backdropFilter: "blur(20px)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2">
                {t("dashboard:allFlights")}
                <span
                  className="px-1.5 py-0.5 text-xs rounded-full"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  {totalCount}
                </span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common:buttons.close")}
                className="text-sm transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {groups.map((group) =>
                group.type === "single" ? (
                  <FlightEntry
                    key={group.flight.id}
                    flight={group.flight}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                ) : (
                  <FlightGroupItem
                    key={group.flights[0].id}
                    flights={group.flights}
                    label={group.label}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                )
              )}
            </div>

            {/* Footer */}
            <div
              className="p-3 flex-shrink-0"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <button type="button" onClick={onAddFlight} className="btn-primary w-full text-sm">
                + {t("dashboard:addFlight")}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
