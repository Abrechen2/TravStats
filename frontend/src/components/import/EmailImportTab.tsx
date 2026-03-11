import { useState, useRef, useCallback } from "react";
import { parseApi } from "../../lib/api";
import type { ParsedBooking } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface EmailImportTabProps {
  onResult: (
    flights: ParsedBooking[],
    subject?: string,
    provider?: string,
    text?: string,
    html?: string
  ) => void;
  onError: (message: string) => void;
}

type DropState = "idle" | "over" | "loading";

export default function EmailImportTab({ onResult, onError }: EmailImportTabProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const [dropState, setDropState] = useState<DropState>("idle");
  const [airlineNotice, setAirlineNotice] = useState<string | null>(null);
  const [emailText, setEmailText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      const allowed = [".eml", ".msg", ".txt"];
      const isPdf = file.name.endsWith(".pdf");

      if (isPdf) {
        onError(
          "PDF-Dateien werden direkt noch nicht unterstützt. Öffne die Email in deinem Email-Client und nutze 'Weiterleiten' oder kopiere den Text."
        );
        return;
      }

      if (!allowed.some((ext) => file.name.endsWith(ext))) {
        onError(`Unterstützte Formate: ${allowed.join(", ")}`);
        return;
      }

      setDropState("loading");
      try {
        const result = await parseApi.parseEmailFile(file);
        setAirlineNotice(result.airlineNotice ?? null);
        if (result.flights.length > 0) {
          onResult(result.flights, result.subject, result.provider, result.text, result.html);
        } else {
          onError(t("flights:form.noFlightsInEmail"));
        }
      } catch (err) {
        logger.error("Email parse failed", err);
        onError(t("flights:form.noFlightsInEmail"));
      } finally {
        setDropState("idle");
      }
    },
    [onResult, onError, t]
  );

  const handleTextParse = useCallback(async (): Promise<void> => {
    if (!emailText.trim()) return;
    setDropState("loading");
    try {
      const result = await parseApi.parseEmail(emailText);
      setAirlineNotice(result.airlineNotice ?? null);
      if (result.flights.length > 0) {
        onResult(result.flights, result.subject, result.provider, result.text, result.html);
      } else {
        onError(t("flights:form.noFlightsInEmail"));
      }
    } catch (err) {
      logger.error("Email text parse failed", err);
      onError(t("flights:form.noFlightsInEmail"));
    } finally {
      setDropState("idle");
    }
  }, [emailText, onResult, onError, t]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      setDropState("idle");
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Drag & Drop Zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDropState("over");
        }}
        onDragLeave={() => setDropState("idle")}
        onClick={() => fileInputRef.current?.click()}
        className={[
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          dropState === "over"
            ? "border-blue-400 bg-blue-950/20"
            : "border-slate-600 hover:border-slate-400",
          dropState === "loading" ? "opacity-50 pointer-events-none" : "",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".eml,.msg,.txt,.pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) void handleFile(e.target.files[0]);
          }}
        />
        <div className="text-3xl mb-2">📧</div>
        <p className="font-medium text-slate-200">
          {dropState === "loading" ? t("common:messages.loading") : t("flights:form.uploadEmail")}
        </p>
        <p className="text-sm text-slate-400 mt-1">.eml, .msg, .txt</p>
        <p className="text-xs text-slate-500 mt-1">PDF: Nur Erkennung, kein automatisches Parsen</p>
      </div>

      {/* Airline Notice */}
      {airlineNotice && (
        <div className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700 rounded-lg px-4 py-3">
          ⚠️ {airlineNotice}
        </div>
      )}

      {/* Text Paste Fallback */}
      <details className="text-sm text-slate-400">
        <summary className="cursor-pointer hover:text-slate-200">
          {t("flights:form.email.textFallback")}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            className="w-full h-32 bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 resize-none"
            placeholder={t("flights:form.email.textPlaceholder")}
          />
          <button
            type="button"
            onClick={() => void handleTextParse()}
            disabled={!emailText.trim() || dropState === "loading"}
            className="self-end px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white"
          >
            {t("common:parse")}
          </button>
        </div>
      </details>
    </div>
  );
}
