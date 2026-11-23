import { useState, useRef } from "react";
import { parseApi } from "../lib/api";
import type { BoardingPassStage } from "../lib/api/types";
import { useTranslation } from "../hooks/useTranslation";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { extractBarcodeFromImage } from "../lib/barcodeExtractor";
import { parseBCBP } from "../lib/bcbpParser";
import { logger } from "../lib/logger";
import { bcbpToScanResult } from "./bcbpToScanResult";
import BoardingPassStages from "./boardingPass/BoardingPassStages";
import { stagesOfError } from "./boardingPass/stageCopy";

import type { ScanResultData } from "./BoardingPassScanner.types";
import { parseFailureMessage } from "../lib/parseErrorCopy";

// Re-export so existing call-sites (`import { ScanResultData } from ".../BoardingPassScanner"`)
// continue to compile without churn.
export type { ScanResultData } from "./BoardingPassScanner.types";

interface BoardingPassScannerProps {
  /** Every flight read off the image — two paper passes on one photo are two. */
  onScanSuccess: (flights: ScanResultData[]) => void;
  onClose: () => void;
}

type StepStatus = "pending" | "loading" | "success" | "error";

interface ScanStep {
  id: "load" | "device" | "server";
  status: StepStatus;
  detail?: string;
}

const STEP_TONE: Record<StepStatus, string> = {
  success: "bg-green-900/20 border-green-800 text-green-200",
  error: "bg-red-900/20 border-red-800 text-red-200",
  loading: "bg-blue-900/20 border-blue-800 text-blue-200",
  pending: "bg-(--bg-elevated) border-border text-(--text-muted)",
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a photo of one or more boarding passes.
 *
 * The browser tries the barcode first (fast, but it only reads a crisp,
 * frame-filling one), then the SERVER reads the image in its fixed order —
 * barcode with cropping/rotation/upscaling, OCR, template/regex parser, flight
 * lookup, AI parser last — and reports every stage. Both outcomes stay on
 * screen until the user goes on: before 2026-11-22 a photo of two United
 * passes passed as "Ollama Vision analysiert…" (it was never the model) and
 * ended in one vague error.
 */
export default function BoardingPassScanner({
  onScanSuccess,
  onClose,
}: BoardingPassScannerProps): JSX.Element {
  const { t } = useTranslation(["flights", "common", "errors", "import"]);
  useEscapeClose(true, onClose);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [steps, setSteps] = useState<ScanStep[]>([]);
  const [stages, setStages] = useState<BoardingPassStage[]>([]);
  const [flights, setFlights] = useState<ScanResultData[] | null>(null);
  const [deviceFlight, setDeviceFlight] = useState<ScanResultData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setStep = (id: ScanStep["id"], update: Omit<ScanStep, "id">) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { id, ...update } : s)));

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setStages([]);
    setFlights(null);
    setDeviceFlight(null);
    setScanning(true);
    setSteps([
      { id: "load", status: "loading" },
      { id: "device", status: "pending" },
      { id: "server", status: "pending" },
    ]);

    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      setStep("load", { status: "error" });
      setError(t("flights:scanner.loadError"));
      setScanning(false);
      return;
    }
    setPreview(dataUrl);
    setStep("load", { status: "success" });

    // 1. The browser's own barcode read — offered as a way on if the server fails.
    setStep("device", { status: "loading" });
    let local: ScanResultData | null = null;
    try {
      const barcode = await extractBarcodeFromImage(file);
      const parsed = barcode ? parseBCBP(barcode) : null;
      local = parsed ? bcbpToScanResult(parsed) : null;
    } catch (err) {
      logger.warn("Browser barcode read failed:", err);
    }
    setDeviceFlight(local);
    setStep(
      "device",
      local
        ? {
            status: "success",
            detail: t("flights:scanner.device.found", {
              flight: `${local.flightNumber ?? ""} ${local.departureCode ?? ""} → ${local.arrivalCode ?? ""}`,
            }),
          }
        : { status: "error", detail: t("flights:scanner.device.none") }
    );

    // 2. The server, every stage reported.
    setStep("server", { status: "loading", detail: t("flights:scanner.serverWorking") });
    try {
      const result = await parseApi.parseBoardingpass(dataUrl.split(",")[1], true);
      const read = result.flights && result.flights.length > 0 ? result.flights : [result.flight];
      setStages(result.stages ?? []);
      setFlights(read);
      setStep("server", { status: "success" });
    } catch (err: unknown) {
      logger.error("Boarding pass parsing failed:", err);
      setStages(stagesOfError(err));
      setStep("server", { status: "error", detail: t("flights:scanner.serverFailed") });
      // Never the server's English `error` or axios's own message.
      setError(parseFailureMessage(err, t, "errors:boardingPassError"));
    }
    setScanning(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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

        <div className="p-6 space-y-6">
          {error && (
            <div role="alert" className="p-4 bg-red-900/20 border-red-800 border rounded-lg">
              <p className="text-red-200">{error}</p>
            </div>
          )}

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
                  data-testid="boarding-pass-file"
                />
                <div className="space-y-3">
                  <div className="text-5xl" aria-hidden="true">
                    🎫
                  </div>
                  <p className="text-lg font-medium text-white">
                    {t("flights:scanner.uploadTitle")}
                  </p>
                  <p className="text-sm mt-1 text-(--text-muted)">
                    {t("flights:scanner.clickToSelect")}
                  </p>
                  <p className="text-xs text-(--text-muted)">
                    {t("flights:scanner.supportedFormats")}
                  </p>
                </div>
              </div>
              <div className="mt-4 p-4 bg-blue-900/20 border-blue-800 border rounded-lg">
                <h3 className="text-sm font-semibold text-blue-200 mb-2">
                  {t("flights:scanner.info.title")}
                </h3>
                <ol className="text-sm text-blue-300 space-y-1 list-decimal list-inside">
                  <li>{t("flights:scanner.info.step1")}</li>
                  <li>{t("flights:scanner.info.step2")}</li>
                  <li>{t("flights:scanner.info.step3")}</li>
                  <li>{t("flights:scanner.info.step4")}</li>
                </ol>
              </div>
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-2">
                <img
                  src={preview}
                  alt={t("flights:scanner.previewAlt")}
                  className="max-w-full max-h-64 mx-auto object-contain rounded-sm"
                />
              </div>

              <ul className="space-y-2">
                {steps.map((step) => (
                  <li
                    key={step.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${STEP_TONE[step.status]}`}
                  >
                    <div className="flex-1">
                      <p className="font-medium">{t(`flights:scanner.steps.${step.id}`)}</p>
                      {step.detail && <p className="text-sm opacity-90">{step.detail}</p>}
                    </div>
                    {step.status === "loading" && (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    )}
                  </li>
                ))}
              </ul>

              {stages.length > 0 && <BoardingPassStages stages={stages} />}

              <div className="flex flex-wrap justify-end gap-2">
                {flights === null && deviceFlight && !scanning && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onScanSuccess([deviceFlight])}
                  >
                    {t("flights:scanner.useDeviceBarcode")}
                  </button>
                )}
                {flights && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onScanSuccess(flights)}
                  >
                    {t("flights:scanner.review", { count: flights.length })}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
