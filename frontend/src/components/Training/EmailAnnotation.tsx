import { useState, useEffect, useRef } from 'react';
import { trainingApi } from '../../lib/api';
import { logger } from '../../lib/logger';

interface EmailAnnotationProps {
  trainingDataId: string;
  onComplete: () => void;
  onCancel?: () => void;
}

interface Flight {
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  price?: string;
  currency?: string;
  [key: string]: any;
}

/**
 * Filter email text to remove links, greetings, footers, etc.
 */
function filterEmailText(text: string): string {
  let filtered = text;

  // Remove HTML tags but keep text content (do this first)
  filtered = filtered.replace(/<[^>]+>/g, '');
  filtered = filtered.replace(/&nbsp;/g, ' ');
  filtered = filtered.replace(/&amp;/g, '&');
  filtered = filtered.replace(/&lt;/g, '<');
  filtered = filtered.replace(/&gt;/g, '>');

  // Remove only full URLs (http/https/www), not domain names in text
  filtered = filtered.replace(/https?:\/\/[^\s<>]+/gi, '');
  filtered = filtered.replace(/www\.[^\s<>]+/gi, '');

  // Remove email addresses (only if they look like actual email addresses)
  filtered = filtered.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');

  // Remove common greetings (German and English) - only at the start
  const greetingPatterns = [
    /^(Sehr\s+geehrte?[rs]?[,\s]+[^\n]+\n?)/gmi,
    /^(Liebe?[rs]?[,\s]+[^\n]+\n?)/gmi,
    /^(Hallo[,\s]+[^\n]+\n?)/gmi,
    /^(Dear\s+[^\n]+\n?)/gmi,
    /^(Hello[,\s]+[^\n]+\n?)/gmi,
    /^(Hi[,\s]+[^\n]+\n?)/gmi,
  ];
  greetingPatterns.forEach(pattern => {
    filtered = filtered.replace(pattern, '');
  });

  // Process line by line
  const lines = filtered.split('\n');
  const footerKeywords = [
    'unsubscribe',
    'abmelden',
    'impressum',
    'datenschutz',
    'privacy policy',
    'terms and conditions',
    'agb',
    'allgemeine geschäftsbedingungen',
  ];

  const processedLines = lines
    .map(line => line.trim())
    .filter(line => {
      // Skip completely empty lines (will be handled by blank line reduction)
      if (line.length === 0) {
        return true; // Keep empty lines for now, we'll reduce them later
      }
      
      // Remove lines with footer keywords
      const lowerLine = line.toLowerCase();
      if (footerKeywords.some(keyword => lowerLine.includes(keyword))) {
        return false;
      }
      
      // Only remove lines that are very short AND contain only whitespace/punctuation
      // Keep short lines that might be important (like airport codes "MUC", "KIX")
      if (line.length <= 3) {
        // Only remove if it's mostly whitespace or just punctuation
        const meaningfulChars = line.replace(/[\s\W]/g, '').length;
        if (meaningfulChars === 0) {
          return false;
        }
      }
      
      return true;
    });

  // Join lines and reduce multiple blank lines to max 1
  filtered = processedLines.join('\n');
  // Reduce multiple consecutive newlines to maximum 1
  filtered = filtered.replace(/\n{2,}/g, '\n');
  // Clean up multiple whitespace within lines (but preserve single spaces)
  filtered = filtered.replace(/[ \t]{2,}/g, ' ');

  // Remove common closings at the end
  const closingPatterns = [
    /(Mit\s+freundlichen\s+Grüßen?[^\n]*\n?[^\n]*)$/gmi,
    /(Viele\s+Grüße?[^\n]*\n?[^\n]*)$/gmi,
    /(Best\s+regards?[^\n]*\n?[^\n]*)$/gmi,
    /(Kind\s+regards?[^\n]*\n?[^\n]*)$/gmi,
    /(Sincerely[^\n]*\n?[^\n]*)$/gmi,
  ];
  closingPatterns.forEach(pattern => {
    filtered = filtered.replace(pattern, '');
  });

  return filtered.trim();
}

export default function EmailAnnotation({ trainingDataId, onComplete, onCancel }: EmailAnnotationProps) {
  const [originalEmailText, setOriginalEmailText] = useState('');
  const [emailText, setEmailText] = useState('');
  const [showFiltered, setShowFiltered] = useState(true);
  const [selectedText, setSelectedText] = useState<{ start: number; end: number; label: string; flightIndex?: number } | null>(null);
  const [annotations, setAnnotations] = useState<Array<{ start: number; end: number; text: string; label: string; flightIndex?: number }>>([]);
  const [flights, setFlights] = useState<Flight[]>([{}]);
  const [selectedFlightIndex, setSelectedFlightIndex] = useState<number>(0); // Flug-Auswahl vor dem Labeln
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
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
          const annotationsData = data.annotations as any;
          if (annotationsData.fullText) {
            setOriginalEmailText(annotationsData.fullText);
            const filtered = filterEmailText(annotationsData.fullText);
            setEmailText(showFiltered ? filtered : annotationsData.fullText);
          }
          if (annotationsData.textSelections) {
            setAnnotations(annotationsData.textSelections);
          }
        }
        
        if (data.extractedData && Array.isArray(data.extractedData) && data.extractedData.length > 0) {
          setFlights(data.extractedData);
        }
        
        if (data.tags && Array.isArray(data.tags)) {
          setTags(data.tags);
        }
      } catch (error) {
        logger.error('Failed to load training data:', error);
        alert('Fehler beim Laden der Training-Daten');
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

  const handleTextSelect = () => {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim() || !textContainerRef.current) {
      return;
    }

    const container = textContainerRef.current;
    const selectedTextStr = selection.toString();
    const fullText = container.textContent || '';
    
    // Finde die Positionen im ursprünglichen Text
    // Suche nach dem ersten Vorkommen des ausgewählten Textes
    const range = selection.getRangeAt(0);
    
    // Erstelle einen Range vom Anfang des Containers bis zum Start der Auswahl
    const startRange = document.createRange();
    startRange.setStart(container, 0);
    startRange.setEnd(range.startContainer, range.startOffset);
    const start = startRange.toString().length;
    
    // Erstelle einen Range vom Anfang des Containers bis zum Ende der Auswahl
    const endRange = document.createRange();
    endRange.setStart(container, 0);
    endRange.setEnd(range.endContainer, range.endOffset);
    const end = endRange.toString().length;
    
    // Verwende den aktuell ausgewählten Flug
    setSelectedText({ start, end, label: '', flightIndex: selectedFlightIndex });
  };

  const handleSaveAnnotation = () => {
    if (selectedText && selectedText.label && selectedText.label !== '') {
      const text = emailText.substring(selectedText.start, selectedText.end).trim();
      const flightIndex = selectedText.flightIndex ?? selectedFlightIndex;
      
      // Annotation hinzufügen
      setAnnotations([...annotations, {
        ...selectedText,
        text,
        flightIndex,
      }]);
      
      // Automatisch Groundtruth ausfüllen
      if (flightIndex < flights.length && text) {
        const updatedFlights = [...flights];
        const flight = updatedFlights[flightIndex];
        
        // Mappe Label zu Flight-Feld
        const labelToField: Record<string, keyof Flight> = {
          flightNumber: 'flightNumber',
          departureCode: 'departureCode',
          arrivalCode: 'arrivalCode',
          departureTime: 'departureTime',
          arrivalTime: 'arrivalTime',
          pnr: 'pnr',
          price: 'price',
          currency: 'currency',
        };
        
        const field = labelToField[selectedText.label];
        if (field) {
          flight[field] = text as any;
          setFlights(updatedFlights);
        }
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
      setAnnotations(annotations.filter(a => a.flightIndex !== index));
      // Update flight indices
      setAnnotations(annotations.map(a => {
        if (a.flightIndex !== undefined && a.flightIndex > index) {
          return { ...a, flightIndex: a.flightIndex - 1 };
        }
        return a;
      }));
    }
  };

  const handleFlightChange = (index: number, field: string, value: any) => {
    const updatedFlights = [...flights];
    updatedFlights[index] = { ...updatedFlights[index], [field]: value };
    setFlights(updatedFlights);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = async (andTrain: boolean) => {
    setSaving(true);
    try {
      const annotationData = {
        type: 'email',
        fullText: originalEmailText,
        textSelections: annotations,
      };

      if (andTrain) {
        await trainingApi.saveAndTrain(trainingDataId, annotationData, flights, tags);
      } else {
        await trainingApi.annotate(trainingDataId, annotationData, flights, tags);
      }

      onComplete();
    } catch (error) {
      logger.error('Failed to save annotation:', error);
      alert('Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Email Annotation
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Email Text wird geladen...
        </p>
      </div>
    );
  }

  const displayText = showFiltered ? emailText : originalEmailText;

  // Render text with visual highlights for annotations
  const renderTextWithHighlights = () => {
    if (!displayText) return 'Kein Text verfügbar';
    
    // Sort annotations by start position
    const sortedAnnotations = [...annotations].sort((a, b) => a.start - b.start);
    
    // Create array of text segments with highlights
    const segments: Array<{ text: string; isHighlight: boolean; label?: string; flightIndex?: number }> = [];
    let lastIndex = 0;
    
    sortedAnnotations.forEach((annotation) => {
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
        const flightLabel = segment.flightIndex !== undefined ? ` (Flug ${segment.flightIndex + 1})` : '';
        return (
          <mark
            key={`highlight-${segmentIndex}`}
            className="bg-yellow-300 dark:bg-yellow-600 px-1 rounded"
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Email Annotation
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Wähle zuerst einen Flug aus, dann markiere relevante Textpassagen und weise ihnen Labels zu
      </p>

      <div className="space-y-4">
        {/* Flug-Auswahl vor dem Labeln */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-300 dark:border-gray-600">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Flug für Annotation auswählen
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
            <button
              onClick={handleAddFlight}
              className="px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              + Flug hinzufügen
            </button>
          </div>
        </div>

        {/* Sticky Label Selector */}
        {selectedText && (
          <div
            ref={labelSelectorRef}
            className="sticky top-0 z-10 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-2 border-blue-500 shadow-lg"
          >
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Ausgewählter Text: "{displayText.substring(selectedText.start, selectedText.end)}"
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Flug {selectedFlightIndex + 1} wird annotiert
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Label
                </label>
                <select
                  value={selectedText.label}
                  onChange={(e) => setSelectedText({ ...selectedText, label: e.target.value })}
                  className="input w-full"
                >
                  <option value="">Label wählen...</option>
                  <option value="flightNumber">Flight Number</option>
                  <option value="departureCode">Departure Code</option>
                  <option value="arrivalCode">Arrival Code</option>
                  <option value="departureTime">Departure Time</option>
                  <option value="arrivalTime">Arrival Time</option>
                  <option value="pnr">PNR</option>
                  <option value="price">Price</option>
                  <option value="currency">Currency</option>
                </select>
              </div>
              <button onClick={handleSaveAnnotation} className="btn-primary" disabled={!selectedText.label || selectedText.label === ''}>
                Speichern
              </button>
              <button onClick={() => setSelectedText(null)} className="btn-secondary">
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {/* Email Text Display */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email Text
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showFiltered}
                onChange={(e) => setShowFiltered(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">Gefiltert anzeigen</span>
            </label>
          </div>
          <div
            ref={textContainerRef}
            className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[300px] max-h-[600px] overflow-y-auto whitespace-pre-wrap select-text"
            onMouseUp={handleTextSelect}
            contentEditable={false}
            suppressContentEditableWarning
          >
            {renderTextWithHighlights()}
          </div>
        </div>

        {/* Multi-Flight Support */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Flight Data (Ground Truth)
            </h3>
            <button
              onClick={handleAddFlight}
              className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              + Flug hinzufügen
            </button>
          </div>
          <div className="space-y-4">
            {flights.map((flight, index) => (
              <div key={index} className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Flug {index + 1}
                  </h4>
                  {flights.length > 1 && (
                    <button
                      onClick={() => handleRemoveFlight(index)}
                      className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Flight Number
                    </label>
                    <input
                      type="text"
                      value={flight.flightNumber || ''}
                      onChange={(e) => handleFlightChange(index, 'flightNumber', e.target.value)}
                      className="input w-full"
                      placeholder="LH103"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      PNR
                    </label>
                    <input
                      type="text"
                      value={flight.pnr || ''}
                      onChange={(e) => handleFlightChange(index, 'pnr', e.target.value)}
                      className="input w-full"
                      placeholder="ABC123"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Departure Code
                    </label>
                    <input
                      type="text"
                      value={flight.departureCode || ''}
                      onChange={(e) => handleFlightChange(index, 'departureCode', e.target.value.toUpperCase())}
                      className="input w-full"
                      placeholder="MUC"
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Arrival Code
                    </label>
                    <input
                      type="text"
                      value={flight.arrivalCode || ''}
                      onChange={(e) => handleFlightChange(index, 'arrivalCode', e.target.value.toUpperCase())}
                      className="input w-full"
                      placeholder="FRA"
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Departure Time
                    </label>
                    <input
                      type="text"
                      value={flight.departureTime || ''}
                      onChange={(e) => handleFlightChange(index, 'departureTime', e.target.value)}
                      className="input w-full"
                      placeholder="2025-11-18T14:30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Arrival Time
                    </label>
                    <input
                      type="text"
                      value={flight.arrivalTime || ''}
                      onChange={(e) => handleFlightChange(index, 'arrivalTime', e.target.value)}
                      className="input w-full"
                      placeholder="2025-11-18T16:15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Price
                    </label>
                    <input
                      type="text"
                      value={flight.price || ''}
                      onChange={(e) => handleFlightChange(index, 'price', e.target.value)}
                      className="input w-full"
                      placeholder="189.50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Currency
                    </label>
                    <input
                      type="text"
                      value={flight.currency || ''}
                      onChange={(e) => handleFlightChange(index, 'currency', e.target.value.toUpperCase())}
                      className="input w-full"
                      placeholder="EUR"
                      maxLength={3}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Tags
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
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
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
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
            <button
              onClick={onCancel}
              disabled={saving}
              className="btn-secondary"
            >
              Abbrechen
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="btn-secondary"
          >
            {saving ? 'Speichern...' : 'Nur speichern'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Speichern...' : 'Speichern & Trainieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
