import { useState, useEffect, useRef } from "react";
import { trainingApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import type { Flight } from "./types";
import { useTranslation } from "../../hooks/useTranslation";
import { filterEmailText } from "../../lib/filterEmailText";
import { markFromSelection, type TextMark } from "./marks";
import type { TemplateDerivation } from "../../lib/api/types";
import {
  AnnotationActions,
  EmailTextPane,
  FlightPicker,
  LabelSelectorPanel,
  MarkedFieldsList,
  TagEditor,
  type SelectedText,
} from "./EmailAnnotationParts";
import {
  annotateFailureCode,
  applyLabelToFlight,
  convertStoredFlights,
  readStoredAnnotation,
  flightsForBackend,
  removeFlightMarks,
} from "./emailAnnotationModel";
import FlightGroundTruth from "./FlightGroundTruth";
import type { WorkshopDomain } from "../../shared/annotationLabels";
import InlineError from "../ui/InlineError";

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
  const [selectedText, setSelectedText] = useState<SelectedText | null>(null);
  const [annotations, setAnnotations] = useState<TextMark[]>([]);
  const [flights, setFlights] = useState<Flight[]>([{}]);
  const [selectedFlightIndex, setSelectedFlightIndex] = useState<number>(0); // Flug-Auswahl vor dem Labeln
  const [annotationHistory, setAnnotationHistory] = useState<TextMark[][]>([]);
  const [flightHistory, setFlightHistory] = useState<Flight[][]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  /**
   * The stored marks were thrown away because they no longer fitted the
   * stored text — see the load effect.
   */
  const [marksDropped, setMarksDropped] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
          const stored = readStoredAnnotation(data.annotations as Record<string, unknown>);
          if (stored.fullText !== null) {
            setOriginalEmailText(stored.fullText);
            const filtered = filterEmailText(stored.fullText);
            setEmailText(showFiltered ? filtered : stored.fullText);
          }
          if (stored.marks !== null) {
            setAnnotations(stored.marks);
            if (stored.marksDropped) setMarksDropped(true);
          }
          if (stored.wasSaved) setShowFiltered(false);
        }

        if (
          data.extractedData &&
          Array.isArray(data.extractedData) &&
          data.extractedData.length > 0
        ) {
          const convertedFlights = convertStoredFlights(data.extractedData);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per training item; t and showFiltered are read at that moment
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
      const flightIndex = selectedText.flightIndex ?? selectedFlightIndex;
      // The offsets move with the trim. They did not, so a selection that
      // caught the newline in front of a value stored a value its own offsets
      // did not point at, and `labelContextOf` then read the line above.
      const mark = markFromSelection(displayText, { ...selectedText, flightIndex });
      if (!mark) {
        setSelectedText(null);
        return;
      }
      const text = mark.text;

      // Save current state to history for undo
      setAnnotationHistory([...annotationHistory, annotations]);
      setFlightHistory([...flightHistory, flights]);

      // Annotation hinzufügen
      setAnnotations([...annotations, mark]);

      // Automatisch Groundtruth ausfüllen. Only the flight domain has a
      // second form to fill: elsewhere the annotation is the ground truth.
      if (isFlight && flightIndex < flights.length && text) {
        const updatedFlights = [...flights];
        const flight = updatedFlights[flightIndex];

        applyLabelToFlight(flight, selectedText.label, text);

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
      // The removed flight's marks go with it; the ones behind it move up an index.
      setAnnotations(removeFlightMarks(annotations, index));
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
      // The text that was MARKED against, never a freshly filtered copy of
      // it. This saved `filterEmailText(originalEmailText)` whatever was on
      // screen, so with the filter switched off every offset was measured in
      // one document and stored against another — and nothing said so, because
      // a shifted offset still yields a template, just one built on the wrong
      // label. `filtered` records which version it is — the load effect above
      // reads it back — and the annotate route refuses the payload outright if
      // the two ever disagree again.
      const annotationData = {
        type: "email",
        fullText: displayText,
        filtered: showFiltered,
        textSelections: annotations,
      };

      // Outside the flight domain the marks ARE the ground truth: there is no
      // second form to reconcile them with, so they travel as one record of
      // label → value rather than as a list of flights.
      const groundTruth = isFlight
        ? flightsForBackend(flights)
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
      // The route refuses a payload whose offsets do not cut their own value
      // out of the text with its own code. "Fehler beim Speichern" would read
      // as a bug in the page; the reader needs to know the marks are the
      // thing that is wrong, and that re-marking clears it. The code itself is
      // never shown — the same rule `MyTemplates` follows for
      // `PREVIEW_REQUIRED`.
      const code = annotateFailureCode(error);
      const message =
        code === "ANNOTATION_TEXT_MISMATCH"
          ? t("training:errors.marksOutOfSync")
          : t("training:errors.saveFailed");
      setSaveError(message);
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-(--text-primary) mb-4">
          {t("training:annotation.title")}
        </h2>
        <p className="text-sm text-(--text-muted)">{t("training:annotation.emailTextLoading")}</p>
      </div>
    );
  }

  const displayText = showFiltered ? emailText : originalEmailText;

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
      <h2 className="text-xl font-semibold text-(--text-primary) mb-4">
        {t("training:annotation.title")}
      </h2>
      {/* The instruction has to know what kind of document this is. It told
          the reader of a hotel confirmation to "choose a flight first" — there
          is no flight to choose, and no flight picker on screen for a
          non-flight sample (beta audit 2026-09-19, unlisted finding 2). */}
      <p className="text-sm text-(--text-muted) mb-4">
        {t(
          isFlight
            ? "training:annotation.descriptionFlight"
            : "training:annotation.descriptionOther"
        )}
      </p>

      <div className="space-y-4">
        {/* Flug-Auswahl vor dem Labeln — a flight mail is the only one that
            carries several of the thing being annotated. */}
        {isFlight && (
          <FlightPicker
            flights={flights}
            selectedFlightIndex={selectedFlightIndex}
            onSelect={setSelectedFlightIndex}
            onAdd={handleAddFlight}
          />
        )}

        {selectedText && (
          <LabelSelectorPanel
            selectedText={selectedText}
            displayText={displayText}
            isFlight={isFlight}
            selectedFlightIndex={selectedFlightIndex}
            domain={domain}
            panelRef={labelSelectorRef}
            canUndo={annotationHistory.length > 0}
            onLabelChange={(label) => setSelectedText({ ...selectedText, label })}
            onSave={handleSaveAnnotation}
            onCancel={() => setSelectedText(null)}
            onUndo={handleUndo}
          />
        )}

        {marksDropped && (
          <p role="status" className="text-sm" style={{ color: "var(--warning)" }}>
            {t("training:annotation.marksDropped")}
          </p>
        )}
        {saveError && <InlineError>{saveError}</InlineError>}

        <EmailTextPane
          displayText={displayText}
          annotations={annotations}
          showFiltered={showFiltered}
          onShowFilteredChange={setShowFiltered}
          containerRef={textContainerRef}
          onMouseUp={handleTextSelect}
        />

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
          <MarkedFieldsList annotations={annotations} domain={domain} />
        )}

        <TagEditor
          tags={tags}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          onAdd={handleAddTag}
          onRemove={handleRemoveTag}
        />

        <AnnotationActions
          saving={saving}
          canUndo={annotationHistory.length > 0}
          onCancel={onCancel}
          onUndo={handleUndo}
          onSave={() => void handleSave()}
        />
      </div>
    </div>
  );
}
