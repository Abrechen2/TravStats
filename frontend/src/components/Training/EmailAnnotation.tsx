import { useState, useEffect, useRef } from "react";
import { trainingApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import {
  Flight,
  getFlightColorClass,
  combineDateTime,
  splitDateTime,
  parseAnnotationText,
} from "./types";
import { useTranslation } from "../../hooks/useTranslation";
import { filterEmailText } from "../../lib/filterEmailText";
import type { TemplateDerivation } from "../../lib/api/types";
import AnnotationLabelSelect from "./AnnotationLabelSelect";
import FlightGroundTruth from "./FlightGroundTruth";
import type { WorkshopDomain } from "../../shared/annotationLabels";

interface EmailAnnotationProps {
  trainingDataId: string;
  /**
   * Which kind of document this is — it decides the labels on offer and what
   * the workshop will derive. Defaults to `flight`, which is what every
   * sample was before forgejo#124 phase 6.
   */
  domain?: WorkshopDomain;
  /**
   * Called with what the workshop made of the annotation — a template, or a
   * reason there is none. The CALLER renders it: this component is unmounted
   * by the same handler, so anything it showed would never be painted.
   */
  onComplete: (derivation?: TemplateDerivation) => void;
  onCancel?: () => void;
}

export default function EmailAnnotation({
  trainingDataId,
  domain = "flight",
  onComplete,
  onCancel,
}: EmailAnnotationProps): JSX.Element {
  const { t } = useTranslation(["training", "parser", "common"]);
  const isFlight = domain === "flight";
  const [originalEmailText, setOriginalEmailText] = useState("");
  const [emailText, setEmailText] = useState("");
  const [showFiltered, setShowFiltered] = useState(true);
  const [selectedText, setSelectedText] = useState<{
    start: number;
    end: number;
    label: string;
    flightIndex?: number;
  } | null>(null);
  const [annotations, setAnnotations] = useState<
    Array<{ start: number; end: number; text: string; label: string; flightIndex?: number }>
  >([]);
  const [flights, setFlights] = useState<Flight[]>([{}]);
  const [selectedFlightIndex, setSelectedFlightIndex] = useState<number>(0); // Flug-Auswahl vor dem Labeln
  const [annotationHistory, setAnnotationHistory] = useState<
    Array<Array<{ start: number; end: number; text: string; label: string; flightIndex?: number }>>
  >([]);
  const [flightHistory, setFlightHistory] = useState<Flight[][]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const labelSelectorRef = useRef<HTMLDivElement>(null);

  // Load email content from training data
  useEffect(() => {
    const loadTrainingData = async () => {
      try {
        setLoading(true);
        const data = await trainingApi.getById(trainingDataId);

        if (data.annotations) {
          const annotationsData = data.annotations as Record<string, unknown>;
          if (typeof annotationsData.fullText === "string") {
            setOriginalEmailText(annotationsData.fullText);
            const filtered = filterEmailText(annotationsData.fullText);
            setEmailText(showFiltered ? filtered : annotationsData.fullText);
          }
          if (Array.isArray(annotationsData.textSelections)) {
            setAnnotations(
              annotationsData.textSelections as Array<{
                start: number;
                end: number;
                text: string;
                label: string;
                flightIndex?: number;
              }>
            );
          }
        }

        if (
          data.extractedData &&
          Array.isArray(data.extractedData) &&
          data.extractedData.length > 0
        ) {
          // Convert old format (with departureTime/arrivalTime as ISO) to new format (separate date/time)
          const convertedFlights = data.extractedData.map((rawFlight: unknown) => {
            const flight = rawFlight as Flight;
            const converted: Flight = { ...flight };
            if (flight.departureTime && !flight.departureDate) {
              const { date, time } = splitDateTime(flight.departureTime);
              if (date) converted.departureDate = date;
              if (time) converted.departureTime = time;
            }
            if (flight.arrivalTime && !flight.arrivalDate) {
              const { date, time } = splitDateTime(flight.arrivalTime);
              if (date) converted.arrivalDate = date;
              if (time) converted.arrivalTime = time;
            }
            // Migrate legacy field names for backward compatibility
            if (flight.price && !flight.aircraft) {
              converted.aircraft = flight.price;
            }
            if ((flight as Record<string, string | undefined>).aircraftType && !flight.aircraft) {
              converted.aircraft = (flight as Record<string, string | undefined>).aircraftType;
            }
            return converted;
          });
          setFlights(convertedFlights);
        }

        if (data.tags && Array.isArray(data.tags)) {
          setTags(data.tags);
        }
      } catch (error) {
        logger.error("Failed to load training data:", error);
        alert(t("training:errors.loadFailed"));
      } finally {
        setLoading(false);
      }
    };

    loadTrainingData();
  }, [trainingDataId]);

  // Update displayed text when filter toggle changes
  useEffect(() => {
    if (originalEmailText) {
      setEmailText(showFiltered ? filterEmailText(originalEmailText) : originalEmailText);
    }
  }, [showFiltered, originalEmailText]);

  /**
   * Walk text nodes within a container to compute character offset to a given node+offset.
   * More reliable than Range.toString() which breaks when startContainer is an element node
   * (can happen when selection starts/ends at a <mark> or <span> boundary).
   */
  const getTextNodeOffset = (container: Node, targetNode: Node, targetOffset: number): number => {
    let accumulated = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node === targetNode) {
        return accumulated + targetOffset;
      }
      accumulated += (node.textContent ?? "").length;
    }
    return accumulated;
  };

  const handleTextSelect = () => {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim() || !textContainerRef.current) {
      return;
    }

    const container = textContainerRef.current;
    const range = selection.getRangeAt(0);

    // Verify selection is within our container
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return;
    }

    const start = getTextNodeOffset(container, range.startContainer, range.startOffset);
    const end = start + range.toString().length;

    setSelectedText({ start, end, label: "", flightIndex: selectedFlightIndex });
  };

  const handleUndo = () => {
    if (annotationHistory.length === 0) return;
    const prevAnnotations = annotationHistory[annotationHistory.length - 1];
    const prevFlights = flightHistory[flightHistory.length - 1];
    setAnnotations(prevAnnotations);
    setFlights(prevFlights);
    setAnnotationHistory(annotationHistory.slice(0, -1));
    setFlightHistory(flightHistory.slice(0, -1));
  };

  const handleSaveAnnotation = () => {
    if (selectedText && selectedText.label && selectedText.label !== "") {
      const text = displayText.substring(selectedText.start, selectedText.end).trim();
      const flightIndex = selectedText.flightIndex ?? selectedFlightIndex;

      // Save current state to history for undo
      setAnnotationHistory([...annotationHistory, annotations]);
      setFlightHistory([...flightHistory, flights]);

      // Annotation hinzufügen
      setAnnotations([
        ...annotations,
        {
          ...selectedText,
          text,
          flightIndex,
        },
      ]);

      // Automatisch Groundtruth ausfüllen. Only the flight domain has a
      // second form to fill: elsewhere the annotation is the ground truth.
      if (isFlight && flightIndex < flights.length && text) {
        const updatedFlights = [...flights];
        const flight = updatedFlights[flightIndex];

        // Mappe Label zu Flight-Feld
        // Note: For date/time labels, we try to parse and split intelligently
        const label = selectedText.label;

        if (label === "departureDate" || label === "departureTime") {
          const { date, time } = parseAnnotationText(text);
          if (label === "departureDate") {
            flight.departureDate = date ?? text;
          }
          if (label === "departureTime") {
            flight.departureTime = time ?? text;
          }
        } else if (label === "arrivalDate" || label === "arrivalTime") {
          const { date, time } = parseAnnotationText(text);
          if (label === "arrivalDate") {
            flight.arrivalDate = date ?? text;
          }
          if (label === "arrivalTime") {
            flight.arrivalTime = time ?? text;
          }
        } else {
          // Simple field mapping
          const labelToField: Record<string, keyof Flight> = {
            flightNumber: "flightNumber",
            airline: "airline",
            departureCode: "departureCode",
            arrivalCode: "arrivalCode",
            pnr: "pnr",
            aircraft: "aircraft",
            seat: "seat",
            seatClass: "seatClass",
            terminal: "terminal",
            gate: "gate",
            ticketNumber: "ticketNumber",
            boardingGroup: "boardingGroup",
          };

          const field = labelToField[label];
          if (field) {
            flight[field] = text;
          }
        }

        setFlights(updatedFlights);
      }

      setSelectedText(null);
    }
  };

  const handleAddFlight = () => {
    setFlights([...flights, {}]);
  };

  const handleRemoveFlight = (index: number) => {
    if (flights.length > 1) {
      setFlights(flights.filter((_, i) => i !== index));
      // Remove annotations for this flight
      setAnnotations(annotations.filter((a) => a.flightIndex !== index));
      // Update flight indices
      setAnnotations(
        annotations.map((a) => {
          if (a.flightIndex !== undefined && a.flightIndex > index) {
            return { ...a, flightIndex: a.flightIndex - 1 };
          }
          return a;
        })
      );
    }
  };

  const handleFlightChange = (index: number, field: string, value: string) => {
    const updatedFlights = [...flights];
    updatedFlights[index] = { ...updatedFlights[index], [field]: value };
    setFlights(updatedFlights);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const annotationData = {
        type: "email",
        fullText: filterEmailText(originalEmailText),
        textSelections: annotations,
      };

      const flightsForBackend = flights.map((flight) => {
        const converted = { ...flight };
        if (flight.departureDate || flight.departureTime) {
          const combined = combineDateTime(flight.departureDate, flight.departureTime);
          if (combined) {
            converted.departureTime = combined;
          }
          delete converted.departureDate;
        }
        if (flight.arrivalDate || flight.arrivalTime) {
          const combined = combineDateTime(flight.arrivalDate, flight.arrivalTime);
          if (combined) {
            converted.arrivalTime = combined;
          }
          delete converted.arrivalDate;
        }
        return converted;
      });

      // Outside the flight domain the marks ARE the ground truth: there is no
      // second form to reconcile them with, so they travel as one record of
      // label → value rather than as a list of flights.
      const groundTruth = isFlight
        ? flightsForBackend
        : [Object.fromEntries(annotations.map((a) => [a.label, a.text]))];

      const response = await trainingApi.annotate(
        trainingDataId,
        annotationData,
        groundTruth,
        tags,
        domain
      );

      // The outcome travels UP, and is not rendered here: `onComplete` takes
      // this view off the screen in the same batch, so a banner owned by this
      // component is mounted and unmounted without ever being painted. That
      // was measured on the abstention note — the user landed on "My
      // templates" with no template and no reason, which is the silent
      // nothing the workshop's abstention exists to end.
      onComplete(response.derivation);
    } catch (error) {
      logger.error("Failed to save annotation:", error);
      alert(t("training:errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-(--text-primary) mb-4">Email Annotation</h2>
        <p className="text-sm text-(--text-muted)">{t("training:annotation.emailTextLoading")}</p>
      </div>
    );
  }

  const displayText = showFiltered ? emailText : originalEmailText;

  // Render text with visual highlights for annotations
  const renderTextWithHighlights = () => {
    if (!displayText) return "Kein Text verfügbar";

    // Sort annotations by start position
    const sortedAnnotations = [...annotations].sort((a, b) => a.start - b.start);

    // Create array of text segments with highlights
    const segments: Array<{
      text: string;
      isHighlight: boolean;
      label?: string;
      flightIndex?: number;
    }> = [];
    let lastIndex = 0;

    sortedAnnotations.forEach((annotation) => {
      // Skip overlapping annotations (same or overlapping range already rendered)
      if (annotation.start < lastIndex) return;

      // Add text before annotation
      if (annotation.start > lastIndex) {
        segments.push({
          text: displayText.substring(lastIndex, annotation.start),
          isHighlight: false,
        });
      }

      // Add highlighted annotation
      segments.push({
        text: displayText.substring(annotation.start, annotation.end),
        isHighlight: true,
        label: annotation.label,
        flightIndex: annotation.flightIndex,
      });

      lastIndex = annotation.end;
    });

    // Add remaining text
    if (lastIndex < displayText.length) {
      segments.push({
        text: displayText.substring(lastIndex),
        isHighlight: false,
      });
    }

    return segments.map((segment, segmentIndex) => {
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
    });
  };

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
      <h2 className="text-xl font-semibold text-(--text-primary) mb-4">
        {t("training:annotation.title")}
      </h2>
      <p className="text-sm text-(--text-muted) mb-4">{t("training:annotation.description")}</p>

      <div className="space-y-4">
        {/* Flug-Auswahl vor dem Labeln — a flight mail is the only one that
            carries several of the thing being annotated. */}
        {isFlight && (
          <div className="p-4 bg-(--bg-base) rounded-lg border border-border">
            <label className="block text-sm font-medium text-(--text-primary) mb-2">
              {t("training:annotation.selectFlight")}
            </label>
            <div className="flex gap-2 items-center">
              <select
                value={selectedFlightIndex}
                onChange={(e) => setSelectedFlightIndex(parseInt(e.target.value))}
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
                onClick={handleAddFlight}
                className="px-3 py-2 text-sm font-medium"
                style={{ color: "var(--ts-accent)" }}
              >
                + Flug hinzufügen
              </button>
            </div>
          </div>
        )}

        {/* Sticky Label Selector */}
        {selectedText && (
          <div
            ref={labelSelectorRef}
            className="sticky top-0 z-10 p-4 bg-blue-50 rounded-lg border-2 border-blue-500 shadow-lg"
          >
            <p className="text-sm font-medium text-(--text-primary) mb-2">
              Ausgewählter Text: &quot;{displayText.substring(selectedText.start, selectedText.end)}
              &quot;
            </p>
            {isFlight && (
              <p className="text-xs text-(--text-muted) mb-2">
                Flug {selectedFlightIndex + 1} wird annotiert
              </p>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Label
                </label>
                {/* The label set follows the DOMAIN of the document — the
                    hardcoded flight list that stood here offered "Gate" for a
                    hotel confirmation (forgejo#124 phase 6). */}
                <AnnotationLabelSelect
                  domain={domain}
                  value={selectedText.label}
                  onChange={(label) => setSelectedText({ ...selectedText, label })}
                />
              </div>
              <button
                onClick={handleSaveAnnotation}
                className="btn-primary"
                disabled={!selectedText.label || selectedText.label === ""}
              >
                {t("common:buttons.save")}
              </button>
              <button onClick={() => setSelectedText(null)} className="btn-secondary">
                {t("common:buttons.cancel")}
              </button>
              {annotationHistory.length > 0 && (
                <button onClick={handleUndo} className="btn-secondary">
                  ↩ Undo
                </button>
              )}
            </div>
          </div>
        )}

        {/* Email Text Display */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-(--text-primary)">Email Text</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showFiltered}
                onChange={(e) => setShowFiltered(e.target.checked)}
                className="rounded-sm border-border text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-(--text-muted)">
                {t("training:annotation.showFiltered")}
              </span>
            </label>
          </div>
          <div
            ref={textContainerRef}
            className="w-full p-4 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) min-h-[300px] max-h-[600px] overflow-y-auto whitespace-pre-wrap select-text"
            onMouseUp={handleTextSelect}
            contentEditable={false}
            suppressContentEditableWarning
          >
            {renderTextWithHighlights()}
          </div>
        </div>

        {/* Ground truth. A flight mail can describe several flights, so it
            gets the grid; every other domain's evidence IS the annotation,
            and a second form beside it would be two places to correct. */}
        {isFlight ? (
          <FlightGroundTruth
            flights={flights}
            onChange={handleFlightChange}
            onAdd={handleAddFlight}
            onRemove={handleRemoveFlight}
          />
        ) : (
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
        )}

        {/* Tags */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-(--text-primary) mb-2">Tags</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="input flex-1"
              placeholder="Tag hinzufügen..."
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="btn-secondary whitespace-nowrap"
            >
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
                    onClick={() => handleRemoveTag(tag)}
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

        <div className="flex gap-3">
          {onCancel && (
            <button onClick={onCancel} disabled={saving} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
          )}
          {annotationHistory.length > 0 && (
            <button onClick={handleUndo} disabled={saving} className="btn-secondary">
              ↩ Undo
            </button>
          )}
          <button onClick={() => void handleSave()} disabled={saving} className="btn-primary">
            {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
          </button>
        </div>
      </div>
    </div>
  );
}
