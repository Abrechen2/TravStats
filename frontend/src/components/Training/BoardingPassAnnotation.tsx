import { useState, useRef, useEffect } from "react";
import { trainingApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import Tesseract from "tesseract.js";
import { Flight, combineDateTime, splitDateTime } from "./types";
import { useTranslation } from "../../hooks/useTranslation";

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

/**
 * Extract text from a bounding box region using OCR
 */
async function extractTextFromBoundingBox(
  imageBase64: string,
  box: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
  originalImageWidth: number,
  originalImageHeight: number
): Promise<string> {
  try {
    // Convert base64 to image
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageBase64;
    });

    // Box coordinates are in canvas space (which may be scaled with DPR)
    // We need to convert them to original image coordinates
    // The canvas is scaled: canvas = originalImage * displayScale * DPR
    // So: originalImage = canvas / (displayScale * DPR)
    // But we don't have displayScale stored, so we calculate it:
    // displayScale = Math.min(maxDisplayWidth/originalWidth, maxDisplayHeight/originalHeight, 1)
    // Actually, we can calculate it from canvas and image dimensions:
    // The canvas width includes DPR scaling, so: canvasWidth = originalWidth * displayScale * DPR

    // Calculate scale from canvas to original image
    // Canvas dimensions already include DPR scaling
    const scaleX = originalImageWidth / canvasWidth;
    const scaleY = originalImageHeight / canvasHeight;

    // Convert box coordinates from canvas space to original image space
    const imageBox = {
      x: Math.max(0, Math.floor(box.x * scaleX)),
      y: Math.max(0, Math.floor(box.y * scaleY)),
      width: Math.min(
        originalImageWidth - Math.floor(box.x * scaleX),
        Math.floor(box.width * scaleX)
      ),
      height: Math.min(
        originalImageHeight - Math.floor(box.y * scaleY),
        Math.floor(box.height * scaleY)
      ),
    };

    // Ensure minimum size
    if (imageBox.width < 1 || imageBox.height < 1) {
      logger.warn("Bounding box too small for OCR");
      return "";
    }

    // Create a temporary canvas to crop the region
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imageBox.width;
    tempCanvas.height = imageBox.height;
    const tempCtx = tempCanvas.getContext("2d");

    if (!tempCtx) {
      logger.error("Failed to get canvas context for OCR");
      return "";
    }

    // Draw the cropped region from the original image
    tempCtx.drawImage(
      img,
      imageBox.x,
      imageBox.y,
      imageBox.width,
      imageBox.height,
      0,
      0,
      imageBox.width,
      imageBox.height
    );

    // Perform OCR on the cropped region
    const {
      data: { text },
    } = await Tesseract.recognize(tempCanvas, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    return text.trim();
  } catch (error) {
    logger.error("OCR extraction failed:", error);
    return "";
  }
}

export default function BoardingPassAnnotation({
  trainingDataId,
  onComplete,
  onCancel,
}: BoardingPassAnnotationProps): JSX.Element {
  const { t } = useTranslation(["training", "common"]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const [currentBox, setCurrentBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null); // Für Bearbeitung
  const [flights, setFlights] = useState<Flight[]>([{}]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imageBase64, setImageBase64] = useState<string>("");

  // Load image from training data
  useEffect(() => {
    const loadTrainingData = async () => {
      try {
        setLoading(true);
        const data = await trainingApi.getById(trainingDataId);

        if (data.annotations) {
          const annotationsData = data.annotations as Record<string, unknown>;
          if (typeof annotationsData.imageBase64 === "string") {
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
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.imageSmoothingEnabled = true;
                  ctx.imageSmoothingQuality = "high";
                }

                drawCanvas();
              }
            };
            img.onerror = () => {
              logger.error("Failed to load image");
              alert(t("training:errors.loadImageFailed"));
            };
            img.src = annotationsData.imageBase64;
          }
          if (Array.isArray(annotationsData.boundingBoxes)) {
            setBoundingBoxes(annotationsData.boundingBoxes as BoundingBox[]);
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

  const handleMouseUp = async () => {
    if (!currentBox || !image) return;

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
      setSelectedLabel("");
      return;
    }

    // Add box first
    setBoundingBoxes([...boundingBoxes, box]);
    setCurrentBox(null);

    // Extract text using OCR and auto-fill ground truth
    setOcrLoading(true);
    try {
      const canvas = canvasRef.current;
      if (canvas && imageBase64 && image) {
        // Get original image dimensions (before scaling)
        // The image object already has the correct dimensions
        const extractedText = await extractTextFromBoundingBox(
          imageBase64,
          box,
          canvas.width,
          canvas.height,
          image.width,
          image.height
        );

        if (extractedText) {
          // Auto-fill ground truth field
          const updatedFlights = [...flights];
          const flight = updatedFlights[0] || {};

          // Map label to field (similar to EmailAnnotation)
          const label = selectedLabel;
          if (label === "departureDate" || label === "departureTime") {
            const { date, time } = splitDateTime(extractedText);
            if (label === "departureDate" && date) {
              flight.departureDate = date;
            } else if (label === "departureTime" && time) {
              flight.departureTime = time;
            } else if (label === "departureDate") {
              flight.departureDate = extractedText;
            } else if (label === "departureTime") {
              flight.departureTime = extractedText;
            }
          } else if (label === "arrivalDate" || label === "arrivalTime") {
            const { date, time } = splitDateTime(extractedText);
            if (label === "arrivalDate" && date) {
              flight.arrivalDate = date;
            } else if (label === "arrivalTime" && time) {
              flight.arrivalTime = time;
            } else if (label === "arrivalDate") {
              flight.arrivalDate = extractedText;
            } else if (label === "arrivalTime") {
              flight.arrivalTime = extractedText;
            }
          } else {
            // Simple field mapping
            const labelToField: Record<string, keyof Flight> = {
              flightNumber: "flightNumber",
              departureCode: "departureCode",
              arrivalCode: "arrivalCode",
              pnr: "pnr",
              seat: "seat",
              gate: "gate",
              terminal: "terminal",
              aircraftType: "aircraftType",
            };

            const field = labelToField[label];
            if (field) {
              flight[field] = extractedText;
            }
          }

          updatedFlights[0] = flight;
          setFlights(updatedFlights);
        }
      }
    } catch (error) {
      logger.error("Failed to extract text from bounding box:", error);
    } finally {
      setOcrLoading(false);
      setSelectedLabel("");
    }
  };

  // ESC-Taste zum Abbrechen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (currentBox) {
          // Zeichnen abbrechen
          setCurrentBox(null);
          setSelectedLabel("");
        } else if (selectedBoxIndex !== null) {
          // Box-Auswahl aufheben
          setSelectedBoxIndex(null);
          setSelectedLabel("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
      setSelectedLabel("");
    }
  };

  // Ausgewählte Box löschen
  const handleDeleteSelectedBox = () => {
    if (selectedBoxIndex !== null) {
      setBoundingBoxes(boundingBoxes.filter((_, index) => index !== selectedBoxIndex));
      setSelectedBoxIndex(null);
      setSelectedLabel("");
    }
  };

  // Zeichnen abbrechen
  const handleCancelDrawing = () => {
    setCurrentBox(null);
    setSelectedLabel("");
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Enable high-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image at full canvas size (already scaled with DPR)
    // The canvas internal size matches the scaled image size
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw existing boxes (they are stored in canvas coordinates, not image coordinates)
    const dpr = window.devicePixelRatio || 1;
    boundingBoxes.forEach((box, index) => {
      // Hervorheben, wenn ausgewählt
      const isSelected = selectedBoxIndex === index;
      ctx.strokeStyle = isSelected ? "#ef4444" : "#3b82f6";
      ctx.lineWidth = (isSelected ? 3 : 2) * dpr;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = isSelected ? "rgba(239, 68, 68, 0.2)" : "rgba(59, 130, 246, 0.2)";
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = isSelected ? "#ef4444" : "#3b82f6";
      ctx.font = `${12 * dpr}px sans-serif`;
      ctx.fillText(box.label, box.x, box.y - 5 * dpr);
    });

    // Draw current box
    if (currentBox) {
      const dpr = window.devicePixelRatio || 1;
      ctx.strokeStyle = "#ef4444";
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
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const annotationData = {
        type: "boarding_pass",
        imageBase64: imageBase64,
        boundingBoxes,
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

      await trainingApi.annotate(trainingDataId, annotationData, flightsForBackend, tags);

      onComplete();
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
        <h2 className="text-xl font-semibold text-(--text-primary) mb-4">
          Boarding Pass Annotation
        </h2>
        <p className="text-sm text-(--text-muted)">{t("training:annotation.imageLoading")}</p>
      </div>
    );
  }

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
      <h2 className="text-xl font-semibold text-(--text-primary) mb-4">
        Boarding Pass Annotation
      </h2>
      <p className="text-sm text-(--text-muted) mb-4">
        {t("training:annotation.drawBoundingBoxes")}
      </p>

      <div className="space-y-4">
        {/* Label-Auswahl und Bearbeitung */}
        <div className="p-4 bg-(--bg-base) rounded-lg border border-border">
          <label className="block text-sm font-medium text-(--text-primary) mb-2">
            {selectedBoxIndex !== null
              ? t("training:annotation.changeLabelForSelected")
              : t("training:annotation.selectLabelBeforeDrawing")}
          </label>
          <div className="flex gap-2">
            <select
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              className="input flex-1"
            >
              <option value="">{t("training:annotation.selectLabel")}</option>
              <option value="flightNumber">Flight Number</option>
              <option value="departureCode">Departure Code</option>
              <option value="arrivalCode">Arrival Code</option>
              <option value="departureDate">Departure Date</option>
              <option value="departureTime">Departure Time</option>
              <option value="arrivalDate">Arrival Date</option>
              <option value="arrivalTime">Arrival Time</option>
              <option value="pnr">PNR</option>
              <option value="seat">Seat</option>
              <option value="gate">Gate</option>
              <option value="terminal">Terminal</option>
              <option value="aircraftType">Aircraft Type</option>
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
                  className="btn-secondary text-white"
                  style={{ background: "var(--danger)" }}
                >
                  Box löschen
                </button>
                <button
                  onClick={() => {
                    setSelectedBoxIndex(null);
                    setSelectedLabel("");
                  }}
                  className="btn-secondary"
                >
                  {t("common:buttons.cancel")}
                </button>
              </>
            )}
            {currentBox && (
              <button onClick={handleCancelDrawing} className="btn-secondary">
                {t("training:annotation.cancelDrawing")}
              </button>
            )}
          </div>
          {selectedBoxIndex !== null && (
            <p className="text-xs text-(--text-muted) mt-2">
              {t("training:annotation.boxSelected", { index: selectedBoxIndex + 1 })}
            </p>
          )}
          {currentBox && (
            <p className="text-xs text-(--text-muted) mt-2">
              {t("training:annotation.drawingInstructions")}
            </p>
          )}
        </div>

        <div className="border border-border rounded-lg p-4 bg-(--bg-base) overflow-auto">
          <canvas
            ref={canvasRef}
            className="border border-border rounded-sm cursor-crosshair max-w-full h-auto"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
        </div>

        {/* OCR Loading Indicator */}
        {ocrLoading && (
          <div
            className="p-4 rounded-lg"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid rgba(240,169,71,0.35)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--accent)" }}>
              🔍 OCR läuft... Text wird extrahiert...
            </p>
          </div>
        )}

        {/* Flight Data (Ground Truth) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-(--text-primary)">
              Flight Data (Ground Truth)
            </h3>
            <p className="text-xs text-(--text-muted)">
              Felder werden automatisch durch OCR ausgefüllt
            </p>
          </div>
          <div className="p-4 border border-border rounded-lg bg-(--bg-base)">
            {flights.map((flight, index) => (
              <div key={index} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Flight Number
                    </label>
                    <input
                      type="text"
                      value={flight.flightNumber || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          flightNumber: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="LH103"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      PNR
                    </label>
                    <input
                      type="text"
                      value={flight.pnr || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = { ...updatedFlights[index], pnr: e.target.value };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="ABC123"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Departure Code
                    </label>
                    <input
                      type="text"
                      value={flight.departureCode || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          departureCode: e.target.value.toUpperCase(),
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="MUC"
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Arrival Code
                    </label>
                    <input
                      type="text"
                      value={flight.arrivalCode || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          arrivalCode: e.target.value.toUpperCase(),
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="FRA"
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Departure Date
                    </label>
                    <input
                      type="date"
                      value={flight.departureDate || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          departureDate: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Departure Time
                    </label>
                    <input
                      type="time"
                      value={flight.departureTime || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          departureTime: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Arrival Date
                    </label>
                    <input
                      type="date"
                      value={flight.arrivalDate || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          arrivalDate: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Arrival Time
                    </label>
                    <input
                      type="time"
                      value={flight.arrivalTime || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          arrivalTime: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Seat
                    </label>
                    <input
                      type="text"
                      value={flight.seat || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = { ...updatedFlights[index], seat: e.target.value };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="16F"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Gate
                    </label>
                    <input
                      type="text"
                      value={flight.gate || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = { ...updatedFlights[index], gate: e.target.value };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="A12"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Terminal
                    </label>
                    <input
                      type="text"
                      value={flight.terminal || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          terminal: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--text-primary) mb-1">
                      Aircraft Type
                    </label>
                    <input
                      type="text"
                      value={flight.aircraftType || ""}
                      onChange={(e) => {
                        const updatedFlights = [...flights];
                        updatedFlights[index] = {
                          ...updatedFlights[index],
                          aircraftType: e.target.value,
                        };
                        setFlights(updatedFlights);
                      }}
                      className="input w-full"
                      placeholder="A320, Boeing 737"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

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
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-sm"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:opacity-70"
                    style={{ color: "var(--accent)" }}
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
          <button onClick={() => void handleSave()} disabled={saving} className="btn-primary">
            {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
          </button>
        </div>
      </div>
    </div>
  );
}
