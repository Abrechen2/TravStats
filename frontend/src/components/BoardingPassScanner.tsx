import { useState, useRef } from "react";
import { parseApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { extractBarcodeFromImage } from "../lib/barcodeExtractor";
import { parseBCBP } from "../lib/bcbpParser";
import { logger } from "../lib/logger";
import { bcbpToScanResult } from "./bcbpToScanResult";

import type { ScanResultData } from "./BoardingPassScanner.types";

// Re-export so existing call-sites (`import { ScanResultData } from ".../BoardingPassScanner"`)
// continue to compile without churn.
export type { ScanResultData } from "./BoardingPassScanner.types";

interface BoardingPassScannerProps {
  onScanSuccess: (data: ScanResultData) => void;
  onClose: () => void;
}

interface ScanStep {
  id: string;
  label: string;
  status: "pending" | "loading" | "success" | "error";
  icon: string;
  detail?: string;
}

export default function BoardingPassScanner({
  onScanSuccess,
  onClose,
}: BoardingPassScannerProps): JSX.Element {
  const { t } = useTranslation(["flights", "common", "errors"]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [scanSteps, setScanSteps] = useState<ScanStep[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateScanStep = (id: string, updates: Partial<ScanStep>) => {
    setScanSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...updates } : step)));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setScanning(true);

    const steps: ScanStep[] = [
      { id: "load", label: t("flights:scanner.steps.load"), status: "loading", icon: "📸" },
      { id: "barcode", label: t("flights:scanner.steps.barcode"), status: "pending", icon: "📱" },
      { id: "parser", label: t("flights:scanner.steps.parser"), status: "pending", icon: "⚙️" },
      { id: "ocr", label: t("flights:scanner.steps.api"), status: "pending", icon: "🔍" },
      { id: "complete", label: t("flights:scanner.steps.complete"), status: "pending", icon: "✅" },
    ];
    setScanSteps(steps);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setPreview(dataUrl);
        updateScanStep("load", { status: "success" });

        try {
          // Step 1: Try barcode extraction first (fast, free)
          updateScanStep("barcode", { status: "loading" });
          const barcodeData = await extractBarcodeFromImage(file);

          if (barcodeData) {
            updateScanStep("barcode", { status: "success", detail: "Barcode gefunden" });
            updateScanStep("parser", { status: "loading" });
            const parsedData = parseBCBP(barcodeData);

            if (parsedData) {
              updateScanStep("parser", {
                status: "success",
                detail: `Flug ${parsedData.flightNumber || ""} ${parsedData.departureAirport} → ${parsedData.arrivalAirport}`,
              });
              updateScanStep("ocr", { status: "pending" });
              updateScanStep("complete", { status: "success" });

              const flightData: ScanResultData = bcbpToScanResult(parsedData);

              await new Promise((resolve) => setTimeout(resolve, 800));
              onScanSuccess(flightData);
              setScanning(false);
              return;
            } else {
              updateScanStep("parser", { status: "error", detail: "Parser fehlgeschlagen" });
            }
          } else {
            updateScanStep("barcode", { status: "error", detail: "Kein Barcode gefunden" });
          }

          // Step 2: Fallback to Tesseract OCR via API
          updateScanStep("ocr", { status: "loading", detail: t("flights:scanner.analyzing") });
          const base64Data = dataUrl.split(",")[1];
          const result = await parseApi.parseBoardingpass(base64Data, false);

          updateScanStep("ocr", {
            status: "success",
            detail: `${result.flight.flightNumber || t("flights:scanner.flight")} ${result.flight.departureCode} ${t("common:labels.routeSeparator")} ${result.flight.arrivalCode}`,
          });

          if (result.enriched) {
            updateScanStep("ocr", { status: "success", detail: t("flights:scanner.enriched") });
          }

          updateScanStep("complete", { status: "success" });
          await new Promise((resolve) => setTimeout(resolve, 800));
          onScanSuccess(result.flight);
          setScanning(false);
        } catch (err: unknown) {
          logger.error("Boarding pass parsing failed:", err);

          const currentStep = steps.find((s) => s.status === "loading");
          if (currentStep) {
            updateScanStep(currentStep.id, { status: "error" });
          }

          const axiosError = err as {
            response?: { status?: number; data?: { error?: string } };
            message?: string;
          };
          setError(
            axiosError.response?.data?.error || axiosError.message || t("errors:boardingPassError")
          );
          setScanning(false);
        }
      };

      reader.onerror = () => {
        updateScanStep("load", { status: "error" });
        setError(t("flights:scanner.loadError"));
        setScanning(false);
      };

      reader.readAsDataURL(file);
    } catch {
      setError(t("flights:scanner.processError"));
      setScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-(--bg-surface) border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{t("flights:scanner.title")}</h2>
          <button
            onClick={onClose}
            disabled={scanning}
            className="p-2 text-(--text-muted) hover:bg-(--bg-elevated) rounded-lg transition-colors"
            aria-label={t("common:buttons.close")}
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

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-900/20 border-red-800 border rounded-lg">
              <div className="flex items-start">
                <span className="text-2xl mr-3" aria-hidden="true">
                  X
                </span>
                <p className="text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* Upload Area */}
          {!scanning && !preview && (
            <div>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors border-border hover:border-(--text-muted) bg-(--bg-elevated)"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileSelect}
                />
                <div className="space-y-3">
                  <div className="text-5xl" aria-hidden="true">
                    🎫
                  </div>
                  <div>
                    <p className="text-lg font-medium text-white">
                      {t("flights:scanner.uploadTitle")}
                    </p>
                    <p className="text-sm mt-1 text-(--text-muted)">
                      {t("flights:scanner.clickToSelect")}
                    </p>
                  </div>
                  <p className="text-xs text-(--text-muted)">
                    {t("flights:scanner.supportedFormats")}
                  </p>
                </div>
              </div>

              {/* Info Box */}
              <div className="mt-4 p-4 bg-blue-900/20 border-blue-800 border rounded-lg">
                <h3 className="text-sm font-semibold text-blue-200 mb-2">
                  {t("flights:scanner.info.title")}
                </h3>
                <ul className="text-sm text-blue-300 space-y-1">
                  <li>• {t("flights:scanner.info.step1")}</li>
                  <li>• {t("flights:scanner.info.step2")}</li>
                  <li>• {t("flights:scanner.info.step3")}</li>
                  <li>• {t("flights:scanner.info.step4")}</li>
                </ul>
              </div>
            </div>
          )}

          {/* Preview & Progress */}
          {preview && (
            <div className="space-y-4">
              {/* Image Preview */}
              <div className="border-2 border-dashed border-border rounded-lg p-2">
                <img
                  src={preview}
                  alt={t("flights:scanner.previewAlt")}
                  className="max-w-full max-h-64 mx-auto object-contain rounded-sm"
                />
              </div>

              {/* Scan Steps */}
              {scanSteps.length > 0 && (
                <div className="space-y-2">
                  {scanSteps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        step.status === "success"
                          ? "bg-green-900/20 border border-green-800"
                          : step.status === "error"
                            ? "bg-red-900/20 border border-red-800"
                            : step.status === "loading"
                              ? "bg-blue-900/20 border border-blue-800"
                              : "bg-(--bg-elevated) border border-border"
                      }`}
                    >
                      <span className="text-2xl" aria-hidden="true">
                        {step.icon}
                      </span>
                      <div className="flex-1">
                        <p
                          className={`font-medium ${
                            step.status === "success"
                              ? "text-green-200"
                              : step.status === "error"
                                ? "text-red-200"
                                : step.status === "loading"
                                  ? "text-blue-200"
                                  : "text-(--text-muted)"
                          }`}
                        >
                          {step.label}
                        </p>
                        {step.detail && (
                          <p
                            className={`text-sm ${
                              step.status === "success"
                                ? "text-green-300"
                                : step.status === "error"
                                  ? "text-red-300"
                                  : "text-blue-300"
                            }`}
                          >
                            {step.detail}
                          </p>
                        )}
                      </div>
                      {step.status === "loading" && (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
