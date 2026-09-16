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
// The shared frame: role=dialog, aria-modal, Escape, focus in and back out,
// and a panel that scrolls instead of running off a 320px screen. This editor
// drew its own overlay and had none of it (AUD-096).
import Modal from "./Modal";
import { useId } from "react";

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

/**
 * A `datetime-local` input has no timezone, so both directions have to agree
 * on one — and they did not: the value was rendered from `toISOString()` (UTC)
 * while the typed value was read back with `new Date(...)`, which reads a bare
 * datetime as the BROWSER's local time. Opening the editor and saving without
 * touching anything therefore moved every time by the browser's offset
 * (AUD-095).
 *
 * UTC on both sides, and the label says so — a time field whose zone the user
 * cannot see is a time field they cannot check.
 */
function toUtcInputValue(iso: string | number | boolean | null | undefined): string {
  if (typeof iso !== "string" || iso === "") return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 16);
}

function fromUtcInputValue(value: string): string | null {
  if (!value) return null;
  // The same zone the value was rendered in, stated explicitly.
  const at = new Date(`${value}:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export default function PendingUpdateEditor({
  update,
  onSave,
  onCancel,
}: PendingUpdateEditorProps): JSX.Element {
  const { t } = useTranslation(["pendingUpdates", "common"]);
  // One prefix per mounted editor, so two of them on a page cannot hand out
  // the same input id — an id collision silently breaks `htmlFor`.
  const fieldIdPrefix = useId();

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
    <Modal
      open
      onClose={onCancel}
      title={t("pendingUpdates:editor.title")}
      maxWidth={896}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-(--bg-muted) text-(--text-primary) rounded-lg hover:bg-(--bg-elevated) transition-colors"
          >
            {t("common:buttons.cancel")}
          </button>
          <button onClick={handleSave} className="btn-primary">
            {t("pendingUpdates:editor.save")}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor Form */}
        <div>
          <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
            {t("pendingUpdates:editor.fieldsTitle")}
          </h3>
          <div className="space-y-4">
            <div>
              <label
                htmlFor={`${fieldIdPrefix}-airline`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.airline")}
              </label>
              <input
                id={`${fieldIdPrefix}-airline`}
                type="text"
                value={editedData.airline || ""}
                onChange={(e) => handleFieldChange("airline", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-aircraft`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.aircraft")}
              </label>
              <input
                id={`${fieldIdPrefix}-aircraft`}
                type="text"
                value={editedData.aircraft || ""}
                onChange={(e) => handleFieldChange("aircraft", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-gate`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.gate")}
              </label>
              <input
                id={`${fieldIdPrefix}-gate`}
                type="text"
                value={editedData.gate || ""}
                onChange={(e) => handleFieldChange("gate", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-terminal`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.terminal")}
              </label>
              <input
                id={`${fieldIdPrefix}-terminal`}
                type="text"
                value={editedData.terminal || ""}
                onChange={(e) => handleFieldChange("terminal", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-depIata`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.depIata")}
              </label>
              <input
                id={`${fieldIdPrefix}-depIata`}
                type="text"
                value={editedData.depIata || ""}
                onChange={(e) => handleFieldChange("depIata", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-arrIata`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.arrIata")}
              </label>
              <input
                id={`${fieldIdPrefix}-arrIata`}
                type="text"
                value={editedData.arrIata || ""}
                onChange={(e) => handleFieldChange("arrIata", e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-departureTime`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.departureTime")}{" "}
                <span className="text-(--text-muted) font-normal">
                  {t("pendingUpdates:editor.utcSuffix")}
                </span>
              </label>
              <input
                id={`${fieldIdPrefix}-departureTime`}
                type="datetime-local"
                value={toUtcInputValue(editedData.departureTime)}
                onChange={(e) =>
                  handleFieldChange("departureTime", fromUtcInputValue(e.target.value))
                }
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldIdPrefix}-arrivalTime`}
                className="block text-sm font-medium text-(--text-primary) mb-1"
              >
                {t("pendingUpdates:editor.arrivalTime")}{" "}
                <span className="text-(--text-muted) font-normal">
                  {t("pendingUpdates:editor.utcSuffix")}
                </span>
              </label>
              <input
                id={`${fieldIdPrefix}-arrivalTime`}
                type="datetime-local"
                value={toUtcInputValue(editedData.arrivalTime)}
                onChange={(e) =>
                  handleFieldChange("arrivalTime", fromUtcInputValue(e.target.value))
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
    </Modal>
  );
}
