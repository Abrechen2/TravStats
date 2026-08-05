/**
 * Pending Update Editor Component
 *
 * Modal for editing pending updates with live preview
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { pendingUpdatesApi } from "../lib/api";
import { logger } from "../lib/logger";
import StatisticsImpactPreview from "./StatisticsImpactPreview";

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

interface PendingUpdate {
  id: string;
  originalData: FlightUpdateData;
  proposedData: FlightUpdateData;
  editedData?: FlightUpdateData;
}

interface PendingUpdateEditorProps {
  update: PendingUpdate;
  onSave: (editedData: FlightUpdateData) => void;
  onCancel: () => void;
}

export default function PendingUpdateEditor({
  update,
  onSave,
  onCancel,
}: PendingUpdateEditorProps): JSX.Element {
  const { t } = useTranslation(["pendingUpdates", "common"]);
  const [editedData, setEditedData] = useState<FlightUpdateData>(
    update.editedData || update.proposedData
  );
  const [previewImpact, setPreviewImpact] = useState<Record<string, unknown> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPreview = useCallback(async (): Promise<void> => {
    try {
      setLoadingPreview(true);
      const impact = await pendingUpdatesApi.preview(update.id, editedData);
      setPreviewImpact(impact);
    } catch (error) {
      logger.error("Failed to load preview:", error);
    } finally {
      setLoadingPreview(false);
    }
  }, [update.id, editedData]);

  // Debounced preview loading (300ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      loadPreview();
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [loadPreview]);

  const handleFieldChange = (field: string, value: string | null): void => {
    setEditedData((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  const handleSave = () => {
    onSave(editedData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-(--text-primary)">
              {t("pendingUpdates:editor.title")}
            </h2>
            <button
              onClick={onCancel}
              aria-label={t("common:buttons.close")}
              className="text-(--text-muted) hover:text-(--text-muted)"
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Editor Form */}
            <div>
              <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
                {t("pendingUpdates:editor.fieldsTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.airline")}
                  </label>
                  <input
                    type="text"
                    value={editedData.airline || ""}
                    onChange={(e) => handleFieldChange("airline", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.aircraft")}
                  </label>
                  <input
                    type="text"
                    value={editedData.aircraft || ""}
                    onChange={(e) => handleFieldChange("aircraft", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.gate")}
                  </label>
                  <input
                    type="text"
                    value={editedData.gate || ""}
                    onChange={(e) => handleFieldChange("gate", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.terminal")}
                  </label>
                  <input
                    type="text"
                    value={editedData.terminal || ""}
                    onChange={(e) => handleFieldChange("terminal", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.depIata")}
                  </label>
                  <input
                    type="text"
                    value={editedData.depIata || ""}
                    onChange={(e) => handleFieldChange("depIata", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.arrIata")}
                  </label>
                  <input
                    type="text"
                    value={editedData.arrIata || ""}
                    onChange={(e) => handleFieldChange("arrIata", e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.departureTime")}
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      editedData.departureTime
                        ? new Date(editedData.departureTime).toISOString().slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      handleFieldChange(
                        "departureTime",
                        e.target.value ? new Date(e.target.value).toISOString() : null
                      )
                    }
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-(--text-primary) mb-1">
                    {t("pendingUpdates:editor.arrivalTime")}
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      editedData.arrivalTime
                        ? new Date(editedData.arrivalTime).toISOString().slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      handleFieldChange(
                        "arrivalTime",
                        e.target.value ? new Date(e.target.value).toISOString() : null
                      )
                    }
                    className="input w-full"
                  />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div>
              <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
                {t("pendingUpdates:editor.preview")}
              </h3>
              {loadingPreview ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <StatisticsImpactPreview impact={previewImpact} />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-(--bg-muted) text-(--text-primary) rounded-lg hover:bg-(--bg-elevated) transition-colors"
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              onClick={handleSave}
              className="btn-primary"
            >
              {t("pendingUpdates:editor.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
