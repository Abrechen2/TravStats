import { useState, useRef, useEffect } from 'react';
import { trainingApi } from '../../lib/api';
import { logger } from '../../lib/logger';

interface BoardingPassAnnotationProps {
  trainingDataId: string;
  onComplete: () => void;
  onCancel?: () => void;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export default function BoardingPassAnnotation({ trainingDataId, onComplete, onCancel }: BoardingPassAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const [currentBox, setCurrentBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null); // Für Bearbeitung
  const [extractedData, setExtractedData] = useState<any>({
    flight: {},
  });
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imageBase64, setImageBase64] = useState<string>('');

  // Load image from training data
  useEffect(() => {
    const loadTrainingData = async () => {
      try {
        setLoading(true);
        const data = await trainingApi.getById(trainingDataId);
        
        if (data.annotations) {
          const annotationsData = data.annotations as any;
          if (annotationsData.imageBase64) {
            setImageBase64(annotationsData.imageBase64);
            
            // Load image
            const img = new Image();
            img.onload = () => {
              setImage(img);
              // Set canvas size to match image with high quality
              if (canvasRef.current) {
                const canvas = canvasRef.current;
                const maxDisplayWidth = 1200;
                const maxDisplayHeight = 800;
                
                // Calculate display scale (for CSS)
                const displayScale = Math.min(
                  maxDisplayWidth / img.width,
                  maxDisplayHeight / img.height,
                  1
                );
                
                // Use device pixel ratio for high DPI displays
                const dpr = window.devicePixelRatio || 1;
                
                // Set display size (CSS)
                canvas.style.width = `${img.width * displayScale}px`;
                canvas.style.height = `${img.height * displayScale}px`;
                
                // Set actual canvas size (internal resolution) - use full image size or scaled with DPR
                const actualScale = displayScale * dpr;
                canvas.width = img.width * actualScale;
                canvas.height = img.height * actualScale;
                
                // Enable high-quality image smoothing
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.imageSmoothingEnabled = true;
                  ctx.imageSmoothingQuality = 'high';
                }
                
                drawCanvas();
              }
            };
            img.onerror = () => {
              logger.error('Failed to load image');
              alert('Fehler beim Laden des Bildes');
            };
            img.src = annotationsData.imageBase64;
          }
          if (annotationsData.boundingBoxes) {
            setBoundingBoxes(annotationsData.boundingBoxes);
          }
        }
        
        if (data.extractedData && Array.isArray(data.extractedData) && data.extractedData.length > 0) {
          setExtractedData({ flight: data.extractedData[0] || {} });
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

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Wenn eine Box ausgewählt ist, nicht neu zeichnen
    if (selectedBoxIndex !== null) {
      return;
    }
    
    const coords = getCanvasCoordinates(e);
    
    // Prüfe, ob auf eine bestehende Box geklickt wurde
    const clickedBoxIndex = boundingBoxes.findIndex((box) => {
      return (
        coords.x >= box.x &&
        coords.x <= box.x + box.width &&
        coords.y >= box.y &&
        coords.y <= box.y + box.height
      );
    });
    
    if (clickedBoxIndex !== -1) {
      // Box auswählen für Bearbeitung
      setSelectedBoxIndex(clickedBoxIndex);
      setSelectedLabel(boundingBoxes[clickedBoxIndex].label);
      return;
    }
    
    // Neue Box beginnen
    setCurrentBox({ startX: coords.x, startY: coords.y, endX: coords.x, endY: coords.y });
    setSelectedBoxIndex(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentBox) return;

    const coords = getCanvasCoordinates(e);
    setCurrentBox({ ...currentBox, endX: coords.x, endY: coords.y });
    drawCanvas();
  };

  const handleMouseUp = () => {
    if (!currentBox) return;
    
    // Wenn keine Label ausgewählt ist, abbrechen
    if (!selectedLabel) {
      setCurrentBox(null);
      return;
    }

    const box: BoundingBox = {
      x: Math.min(currentBox.startX, currentBox.endX),
      y: Math.min(currentBox.startY, currentBox.endY),
      width: Math.abs(currentBox.endX - currentBox.startX),
      height: Math.abs(currentBox.endY - currentBox.startY),
      label: selectedLabel,
    };

    // Prüfe, ob Box groß genug ist (mindestens 10x10 Pixel)
    if (box.width < 10 || box.height < 10) {
      setCurrentBox(null);
      setSelectedLabel('');
      return;
    }

    setBoundingBoxes([...boundingBoxes, box]);
    setCurrentBox(null);
    setSelectedLabel('');
  };
  
  // ESC-Taste zum Abbrechen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentBox) {
          // Zeichnen abbrechen
          setCurrentBox(null);
          setSelectedLabel('');
        } else if (selectedBoxIndex !== null) {
          // Box-Auswahl aufheben
          setSelectedBoxIndex(null);
          setSelectedLabel('');
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentBox, selectedBoxIndex]);
  
  // Label für ausgewählte Box aktualisieren
  const handleUpdateSelectedBoxLabel = () => {
    if (selectedBoxIndex !== null && selectedLabel) {
      const updatedBoxes = [...boundingBoxes];
      updatedBoxes[selectedBoxIndex] = {
        ...updatedBoxes[selectedBoxIndex],
        label: selectedLabel,
      };
      setBoundingBoxes(updatedBoxes);
      setSelectedBoxIndex(null);
      setSelectedLabel('');
    }
  };
  
  // Ausgewählte Box löschen
  const handleDeleteSelectedBox = () => {
    if (selectedBoxIndex !== null) {
      setBoundingBoxes(boundingBoxes.filter((_, index) => index !== selectedBoxIndex));
      setSelectedBoxIndex(null);
      setSelectedLabel('');
    }
  };
  
  // Zeichnen abbrechen
  const handleCancelDrawing = () => {
    setCurrentBox(null);
    setSelectedLabel('');
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Enable high-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw image at full canvas size (already scaled with DPR)
    // The canvas internal size matches the scaled image size
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw existing boxes (they are stored in canvas coordinates, not image coordinates)
    const dpr = window.devicePixelRatio || 1;
    boundingBoxes.forEach((box, index) => {
      // Hervorheben, wenn ausgewählt
      const isSelected = selectedBoxIndex === index;
      ctx.strokeStyle = isSelected ? '#ef4444' : '#3b82f6';
      ctx.lineWidth = (isSelected ? 3 : 2) * dpr;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = isSelected ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = isSelected ? '#ef4444' : '#3b82f6';
      ctx.font = `${12 * dpr}px sans-serif`;
      ctx.fillText(box.label, box.x, box.y - 5 * dpr);
    });

    // Draw current box
    if (currentBox) {
      const dpr = window.devicePixelRatio || 1;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(
        Math.min(currentBox.startX, currentBox.endX),
        Math.min(currentBox.startY, currentBox.endY),
        Math.abs(currentBox.endX - currentBox.startX),
        Math.abs(currentBox.endY - currentBox.startY)
      );
    }
  };

  useEffect(() => {
    drawCanvas();
  }, [boundingBoxes, currentBox, image, selectedBoxIndex]);

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
        type: 'boarding_pass',
        imageBase64: imageBase64,
        boundingBoxes,
      };

      if (andTrain) {
        await trainingApi.saveAndTrain(trainingDataId, annotationData, [extractedData.flight], tags);
      } else {
        await trainingApi.annotate(trainingDataId, annotationData, [extractedData.flight], tags);
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
          Boarding Pass Annotation
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Bild wird geladen...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Boarding Pass Annotation
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Zeichne Bounding Boxes um relevante Bereiche
      </p>

      <div className="space-y-4">
        {/* Label-Auswahl und Bearbeitung */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-300 dark:border-gray-600">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {selectedBoxIndex !== null ? 'Label für ausgewählte Box ändern' : 'Label wählen (vor dem Zeichnen)'}
          </label>
          <div className="flex gap-2">
            <select
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              className="input flex-1"
            >
              <option value="">Label wählen...</option>
              <option value="flightNumber">Flight Number</option>
              <option value="departureCode">Departure Code</option>
              <option value="arrivalCode">Arrival Code</option>
              <option value="departureTime">Departure Time</option>
              <option value="arrivalTime">Arrival Time</option>
              <option value="seat">Seat</option>
              <option value="gate">Gate</option>
              <option value="terminal">Terminal</option>
            </select>
            {selectedBoxIndex !== null && (
              <>
                <button
                  onClick={handleUpdateSelectedBoxLabel}
                  disabled={!selectedLabel}
                  className="btn-primary"
                >
                  Label aktualisieren
                </button>
                <button
                  onClick={handleDeleteSelectedBox}
                  className="btn-secondary bg-red-600 hover:bg-red-700 text-white"
                >
                  Box löschen
                </button>
                <button
                  onClick={() => {
                    setSelectedBoxIndex(null);
                    setSelectedLabel('');
                  }}
                  className="btn-secondary"
                >
                  Abbrechen
                </button>
              </>
            )}
            {currentBox && (
              <button
                onClick={handleCancelDrawing}
                className="btn-secondary"
              >
                Zeichnen abbrechen (ESC)
              </button>
            )}
          </div>
          {selectedBoxIndex !== null && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Box {selectedBoxIndex + 1} ausgewählt. Klicke auf eine andere Box oder ändere das Label.
            </p>
          )}
          {currentBox && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Zeichne eine Box. Drücke ESC oder klicke "Abbrechen" zum Abbrechen.
            </p>
          )}
        </div>

        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-700 overflow-auto">
          <canvas
            ref={canvasRef}
            className="border border-gray-300 dark:border-gray-600 rounded cursor-crosshair max-w-full h-auto"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Flight Data (Ground Truth)
          </h3>
          <textarea
            value={JSON.stringify(extractedData, null, 2)}
            onChange={(e) => {
              try {
                setExtractedData(JSON.parse(e.target.value));
              } catch {
                // Invalid JSON, ignore
              }
            }}
            className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm min-h-[200px]"
            placeholder='{"flight": {"flightNumber": "LH103", ...}}'
          />
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

