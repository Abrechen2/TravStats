/**
 * Pending Update Card Component
 *
 * Displays a single pending update with options to apply, reject, or edit
 */

import { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import ChangeDiffView from "./ChangeDiffView";
import PendingUpdateEditor from "./PendingUpdateEditor";

interface FlightUpdateData {
  airline?: string;
  aircraft?: string;
  gate?: string;
  terminal?: string;
  depIata?: string;
  arrIata?: string;
  departureTime?: string;
  arrivalTime?: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface ChangeEntry {
  field: string;
  type: "added" | "removed" | "changed";
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

interface StatisticsImpact {
  distance?: {
    change: number;
  };
  [key: string]: unknown;
}

interface PendingUpdate {
  id: string;
  flightId: string;
  status: "pending" | "applied" | "rejected" | "expired" | "edited";
  originalData: FlightUpdateData;
  proposedData: FlightUpdateData;
  editedData?: FlightUpdateData;
  changes: ChangeEntry[];
  editedChanges?: ChangeEntry[];
  apiSource: string;
  fetchedAt: string;
  expiresAt: string;
  metadata?: {
    isHistoricalEnrichment?: boolean;
    enrichmentMode?: "full" | "slim";
    confidence?: number;
    sourceFlightsCount?: number;
  };
  appliedAt?: string;
  rejectedAt?: string;
  statisticsImpact?: StatisticsImpact;
  flight?: {
    id: string;
    flightNumber: string | null;
    airline: string | null;
    departureTime: string;
    arrivalTime: string;
    depIata: string | null;
    arrIata: string | null;
  };
}

interface PendingUpdateCardProps {
  update: PendingUpdate;
  onApply: () => void;
  onReject: () => void;
  onEdit: (editedData: FlightUpdateData) => void;
  onSelect: () => void;
  isSelected: boolean;
}

export default function PendingUpdateCard({
  update,
  onApply,
  onReject,
  onEdit,
  onSelect: _onSelect, // eslint-disable-line @typescript-eslint/no-unused-vars
  isSelected,
}: PendingUpdateCardProps): JSX.Element {
  const { t } = useTranslation(["common", "pendingUpdates"]);
  const [showEditor, setShowEditor] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "applied":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "expired":
        return "bg-(--bg-elevated) text-(--text-primary)";
      case "edited":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-(--bg-elevated) text-(--text-primary)";
    }
  };

  const getStatusLabel = (status: string) => {
    return t(`pendingUpdates:status.${status}`);
  };

  const getApiSourceLabel = (source: string): string => {
    const labels: Record<string, string> = {
      historical_aggregation: t("pendingUpdates:apiSource.historicalAggregation"),
      airlabs: "AirLabs API",
      aviationstack: "Aviationstack API",
      aerodatabox: "AeroDataBox API",
      opensky: "OpenSky Network",
    };
    return labels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
  };

  const timeUntilExpiry = () => {
    const now = new Date().getTime();
    const expiry = new Date(update.expiresAt).getTime();
    const diff = expiry - now;

    if (diff <= 0) return t("pendingUpdates:expired");
    if (diff < 60 * 60 * 1000) {
      return `${Math.floor(diff / (60 * 1000))} ${t("pendingUpdates:minutes")}`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return `${Math.floor(diff / (60 * 60 * 1000))} ${t("pendingUpdates:hours")}`;
    }
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))} ${t("pendingUpdates:days")}`;
  };

  const changesToShow = update.editedChanges || update.changes;
  const dataToShow = update.editedData || update.proposedData;

  return (
    <>
      <div
        className={`bg-(--bg-surface) rounded-lg shadow-xs border-2 ${
          isSelected ? "border-blue-500" : "border-transparent"
        } transition-all hover:shadow-md`}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-1 rounded-sm text-xs font-medium ${getStatusColor(update.status)}`}
              >
                {getStatusLabel(update.status)}
              </span>
              <span className="text-xs text-(--text-muted)">
                {getApiSourceLabel(update.apiSource)}
              </span>
              {update.metadata?.isHistoricalEnrichment && (
                <span
                  className="px-2 py-0.5 text-xs font-semibold rounded-full"
                  style={{
                    background:
                      update.metadata.enrichmentMode === "full"
                        ? "rgba(34,197,94,0.15)"
                        : "rgba(240,169,71,0.15)",
                    color:
                      update.metadata.enrichmentMode === "full"
                        ? "rgb(22,163,74)"
                        : "var(--accent)",
                  }}
                >
                  {update.metadata.enrichmentMode === "full"
                    ? t("pendingUpdates:enrichment.fullBadge")
                    : t("pendingUpdates:enrichment.slimBadge")}
                </span>
              )}
            </div>
            {update.status === "pending" && (
              <span className="text-xs text-(--text-muted)">
                {t("pendingUpdates:expiresIn")} {timeUntilExpiry()}
              </span>
            )}
          </div>
          {update.flight && (
            <div>
              <h3 className="text-lg font-semibold text-(--text-primary)">
                {update.flight.airline || "Unknown"} {update.flight.flightNumber || ""}
              </h3>
              <p className="text-sm text-(--text-muted)">
                {update.flight.depIata} → {update.flight.arrIata}
              </p>
            </div>
          )}
          {update.metadata?.isHistoricalEnrichment && (
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("pendingUpdates:enrichment.disclaimer", {
                count: update.metadata.sourceFlightsCount ?? 0,
                confidence: update.metadata.confidence ?? 0,
              })}
            </p>
          )}
        </div>

        {/* Changes Preview */}
        <div className="p-4">
          <div className="mb-3">
            <h4 className="text-sm font-medium text-(--text-primary) mb-2">
              {t("pendingUpdates:changes.title")}
            </h4>
            <div className="space-y-1">
              {changesToShow.slice(0, 3).map((change, index) => (
                <div key={index} className="text-sm">
                  <span className="font-medium text-(--text-primary)">{change.field}:</span>{" "}
                  <span className="text-red-600 line-through">{change.oldValue || "-"}</span> →{" "}
                  <span className="text-green-600">{change.newValue || "-"}</span>
                </div>
              ))}
              {changesToShow.length > 3 && (
                <div className="text-sm text-(--text-muted)">
                  +{changesToShow.length - 3} {t("pendingUpdates:changes.more")}
                </div>
              )}
            </div>
          </div>

          {update.statisticsImpact && (
            <div className="mt-3 p-3 bg-(--bg-base) rounded-sm">
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:statisticsImpact")}
              </div>
              <div className="text-sm">
                {update.statisticsImpact.distance && (
                  <div>
                    {t("pendingUpdates:distance")}:{" "}
                    <span
                      className={
                        update.statisticsImpact.distance.change > 0
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {update.statisticsImpact.distance.change > 0 ? "+" : ""}
                      {update.statisticsImpact.distance.change} km
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {update.status === "pending" || update.status === "edited" ? (
          <div className="p-4 border-t border-border flex gap-2">
            <button onClick={() => setShowEditor(true)} className="btn-secondary flex-1">
              {t("pendingUpdates:actions.edit")}
            </button>
            <button onClick={onApply} className="btn-primary flex-1">
              {t("pendingUpdates:actions.apply")}
            </button>
            <button onClick={onReject} className="btn-danger flex-1">
              {t("pendingUpdates:actions.reject")}
            </button>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-4 py-2 bg-(--bg-muted) text-(--text-primary) rounded-lg hover:bg-(--bg-elevated) transition-colors"
            >
              {showDetails ? "−" : "+"}
            </button>
          </div>
        ) : (
          <div className="p-4 border-t border-border text-sm text-(--text-muted)">
            {update.status === "applied" && update.appliedAt && (
              <div>
                {t("pendingUpdates:appliedAt")} {new Date(update.appliedAt).toLocaleString()}
              </div>
            )}
            {update.status === "rejected" && update.rejectedAt && (
              <div>
                {t("pendingUpdates:rejectedAt")} {new Date(update.rejectedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Details */}
        {showDetails && (
          <div className="p-4 border-t border-border">
            <ChangeDiffView
              original={update.originalData}
              proposed={dataToShow}
              changes={changesToShow}
            />
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <PendingUpdateEditor
          update={update}
          onSave={(editedData) => {
            onEdit(editedData);
            setShowEditor(false);
          }}
          onCancel={() => setShowEditor(false)}
        />
      )}
    </>
  );
}
