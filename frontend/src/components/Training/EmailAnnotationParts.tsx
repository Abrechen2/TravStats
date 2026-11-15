import type { JSX, RefObject } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightColorClass, type Flight } from "./types";
import { markFromSelection, type TextMark } from "./marks";
import AnnotationLabelSelect from "./AnnotationLabelSelect";
import type { WorkshopDomain } from "../../shared/annotationLabels";
import { segmentsOf } from "./emailAnnotationModel";

export interface SelectedText {
  start: number;
  end: number;
  label: string;
  flightIndex?: number;
}

/** The mail text with every mark painted; plain "no text" notice when empty. */
export function HighlightedText({
  displayText,
  annotations,
}: {
  displayText: string;
  annotations: TextMark[];
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  if (!displayText) return <>{t("training:annotation.noText")}</>;
  const segments = segmentsOf(displayText, annotations);
  return (
    <>
      {segments.map((segment, segmentIndex) => {
        if (segment.isHighlight) {
          const flightLabel =
            segment.flightIndex !== undefined ? ` (Flug ${segment.flightIndex + 1})` : "";
          const flightIndex = segment.flightIndex ?? 0;
          const colorClass = getFlightColorClass(flightIndex);
          return (
            <mark
              key={`highlight-${segmentIndex}`}
              className={`${colorClass} px-1 rounded-sm`}
              title={`${segment.label}${flightLabel}`}
            >
              {segment.text}
            </mark>
          );
        }
        return <span key={`text-${segmentIndex}`}>{segment.text}</span>;
      })}
    </>
  );
}

/** Which flight the next mark belongs to — a flight mail can carry several. */
export function FlightPicker({
  flights,
  selectedFlightIndex,
  onSelect,
  onAdd,
}: {
  flights: Flight[];
  selectedFlightIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div className="p-4 bg-(--bg-base) rounded-lg border border-border">
      <label className="block text-sm font-medium text-(--text-primary) mb-2">
        {t("training:annotation.selectFlight")}
      </label>
      <div className="flex gap-2 items-center">
        <select
          value={selectedFlightIndex}
          onChange={(e) => onSelect(parseInt(e.target.value))}
          className="input flex-1"
          disabled={flights.length === 0}
        >
          {flights.map((_, index) => (
            <option key={index} value={index}>
              Flug {index + 1}
            </option>
          ))}
        </select>
        {/* One colour for one action: the identical button inside
              `FlightGroundTruth` resolves through the token layer, and two
              shades of "add a flight" on one screen is a bug you only see
              in a browser. */}
        <button
          onClick={onAdd}
          className="px-3 py-2 text-sm font-medium"
          style={{ color: "var(--ts-accent)" }}
        >
          + Flug hinzufügen
        </button>
      </div>
    </div>
  );
}

/** The label chooser that opens under a selection: pick a label, save, cancel or undo. */
export function LabelSelectorPanel({
  selectedText,
  displayText,
  isFlight,
  selectedFlightIndex,
  domain,
  panelRef,
  canUndo,
  onLabelChange,
  onSave,
  onCancel,
  onUndo,
}: {
  selectedText: SelectedText;
  displayText: string;
  isFlight: boolean;
  selectedFlightIndex: number;
  domain: WorkshopDomain;
  panelRef: RefObject<HTMLDivElement | null>;
  canUndo: boolean;
  onLabelChange: (label: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUndo: () => void;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div
      ref={panelRef}
      className="sticky top-0 z-10 p-4 bg-blue-50 rounded-lg border-2 border-blue-500 shadow-lg"
    >
      <p className="text-sm font-medium text-(--text-primary) mb-2">
        {/* The TRIMMED value, resolved through the same helper the mark
              itself is built with. The preview showed the raw selection,
              so a drag that caught the newline in front of a value offered
              to label something the stored mark would not contain — two
              answers to one question, which is what `markFromSelection`
              exists to end. */}
        {t("training:annotation.selectedText", {
          value: markFromSelection(displayText, selectedText)?.text ?? "",
        })}
      </p>
      {isFlight && (
        <p className="text-xs text-(--text-muted) mb-2">
          Flug {selectedFlightIndex + 1} wird annotiert
        </p>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-(--text-primary) mb-1">Label</label>
          {/* The label set follows the DOMAIN of the document — the
                hardcoded flight list that stood here offered "Gate" for a
                hotel confirmation (forgejo#124 phase 6). */}
          <AnnotationLabelSelect
            domain={domain}
            value={selectedText.label}
            onChange={onLabelChange}
          />
        </div>
        <button
          onClick={onSave}
          className="btn-primary"
          disabled={!selectedText.label || selectedText.label === ""}
        >
          {t("common:buttons.save")}
        </button>
        <button onClick={onCancel} className="btn-secondary">
          {t("common:buttons.cancel")}
        </button>
        {canUndo && (
          <button onClick={onUndo} className="btn-secondary">
            ↩ Undo
          </button>
        )}
      </div>
    </div>
  );
}

/** The mail text with its "filtered" switch — locked once anything is marked. */
export function EmailTextPane({
  displayText,
  annotations,
  showFiltered,
  onShowFilteredChange,
  containerRef,
  onMouseUp,
}: {
  displayText: string;
  annotations: TextMark[];
  showFiltered: boolean;
  onShowFilteredChange: (value: boolean) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  onMouseUp: () => void;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-(--text-primary)">
          {t("training:annotation.emailText")}
        </label>
        {/* Locked once anything is marked: the marks point into the text
          on screen, and that text is what gets saved. Switching the
          filter under them would move every offset off its value — the
          defect this whole change is about, one level up. */}
        <label
          className={`flex items-center gap-2 ${
            annotations.length > 0 ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={showFiltered}
            disabled={annotations.length > 0}
            onChange={(e) => onShowFilteredChange(e.target.checked)}
            className="rounded-sm border-border text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-(--text-muted)">
            {annotations.length > 0
              ? t("training:annotation.filterLocked")
              : t("training:annotation.showFiltered")}
          </span>
        </label>
      </div>
      <div
        ref={containerRef}
        className="w-full p-4 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) min-h-[300px] max-h-[600px] overflow-y-auto whitespace-pre-wrap select-text"
        onMouseUp={onMouseUp}
        contentEditable={false}
        suppressContentEditableWarning
      >
        <HighlightedText displayText={displayText} annotations={annotations} />
      </div>
    </div>
  );
}

/** Outside the flight domain the marks ARE the ground truth: shown as a plain list. */
export function MarkedFieldsList({
  annotations,
  domain,
}: {
  annotations: TextMark[];
  domain: WorkshopDomain;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div>
      <h3 className="text-sm font-medium text-(--text-primary) mb-2">
        {t("parser:workshop.markedFields")}
      </h3>
      {annotations.length === 0 ? (
        <p className="text-sm text-(--text-muted)">{t("parser:workshop.markedNothing")}</p>
      ) : (
        <ul className="space-y-1">
          {annotations.map((annotation, index) => (
            <li key={index} className="text-sm text-(--text-primary)">
              <span className="text-(--text-muted)">
                {t(`parser:labels.${domain}.${annotation.label}`)}:{" "}
              </span>
              {annotation.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Free-text tags of a sample. */
export function TagEditor({
  tags,
  tagInput,
  onTagInputChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  tagInput: string;
  onTagInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-(--text-primary) mb-2">
        {t("training:annotation.tags")}
      </label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          className="input flex-1"
          placeholder="Tag hinzufügen..."
        />
        <button type="button" onClick={onAdd} className="btn-secondary whitespace-nowrap">
          Tag hinzufügen
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-sm text-sm"
            >
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                className="text-blue-600 hover:text-blue-800"
                aria-label={`Tag ${tag} entfernen`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cancel, undo and save under the form. */
export function AnnotationActions({
  saving,
  canUndo,
  onCancel,
  onUndo,
  onSave,
}: {
  saving: boolean;
  canUndo: boolean;
  onCancel?: () => void;
  onUndo: () => void;
  onSave: () => void;
}): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  return (
    <div className="flex gap-3">
      {onCancel && (
        <button onClick={onCancel} disabled={saving} className="btn-secondary">
          {t("common:buttons.cancel")}
        </button>
      )}
      {canUndo && (
        <button onClick={onUndo} disabled={saving} className="btn-secondary">
          ↩ Undo
        </button>
      )}
      <button onClick={onSave} disabled={saving} className="btn-primary">
        {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
      </button>
    </div>
  );
}
