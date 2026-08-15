import { useState, useRef, useCallback, useEffect } from "react";
import type { JSX } from "react";
import { parseApi } from "../../lib/api";
import { api } from "../../lib/api/client";
import type { ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
import { useTranslation } from "../../hooks/useTranslation";
import { useMinLoadingState } from "../../hooks/useMinLoadingState";
import { GlobeLoader } from "../GlobeLoader";
import { logger } from "../../lib/logger";
import { extractApiErrorMessage } from "../../lib/apiError";
import type { ParseableImportDomain } from "./types";

interface EmailImportTabProps {
  /** Only a domain the backend can actually parse for — see `types.ts`. */
  domain: ParseableImportDomain;
  acceptedExtensions: string[];
  onEmailResult: (result: ParseEmailResult) => void;
  /**
   * Called when a `.pdf` is dropped in the email tab — kept for back-compat
   * with the flight workflow that auto-detects PDFs in this tab.
   */
  onPdfResult?: (result: ParsePdfResult) => void;
  onError: (message: string) => void;
}

type DropState = "idle" | "over" | "loading";

export default function EmailImportTab({
  domain,
  acceptedExtensions,
  onEmailResult,
  onPdfResult,
  onError,
}: EmailImportTabProps): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [dropState, setDropState] = useState<DropState>("idle");
  const [emailText, setEmailText] = useState("");
  const [hasLlm, setHasLlm] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showLoader = useMinLoadingState(dropState === "loading", 2000);

  useEffect(() => {
    api
      .get<{ hasLlm: boolean }>("/parser-capabilities")
      .then(({ data }) => setHasLlm(Boolean(data?.hasLlm)))
      .catch(() => setHasLlm(null));
  }, []);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      const lowerName = file.name.toLowerCase();
      const isPdf = lowerName.endsWith(".pdf");

      if (isPdf && onPdfResult) {
        setDropState("loading");
        try {
          const arrayBuffer = await file.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const pdfBase64 = btoa(binary);
          const result = await parseApi.parsePdf(pdfBase64, domain);
          onPdfResult(result);
        } catch (err) {
          logger.error("EmailImportTab: PDF parse failed", err);
          onError(extractApiErrorMessage(err, t("import:pdf.parseError")));
        } finally {
          setDropState("idle");
        }
        return;
      }

      if (!acceptedExtensions.some((ext) => lowerName.endsWith(ext))) {
        onError(t("import:email.unsupportedFormat", { formats: acceptedExtensions.join(", ") }));
        return;
      }

      setDropState("loading");
      try {
        const result = await parseApi.parseEmailFile(file, domain);
        onEmailResult(result);
      } catch (err) {
        logger.error("EmailImportTab: email file parse failed", err);
        onError(extractApiErrorMessage(err, t("import:email.parseError")));
      } finally {
        setDropState("idle");
      }
    },
    [domain, acceptedExtensions, onEmailResult, onPdfResult, onError, t]
  );

  const handleTextParse = useCallback(async (): Promise<void> => {
    if (!emailText.trim()) return;
    setDropState("loading");
    try {
      const result = await parseApi.parseEmail(emailText, undefined, domain);
      onEmailResult(result);
    } catch (err) {
      logger.error("EmailImportTab: email text parse failed", err);
      onError(extractApiErrorMessage(err, t("import:email.parseError")));
    } finally {
      setDropState("idle");
    }
  }, [emailText, domain, onEmailResult, onError, t]);

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
      {hasLlm === false && (
        <div className="text-sm text-amber-300 bg-amber-900/20 border border-amber-700 rounded-lg px-4 py-3">
          <p className="font-medium mb-1">{t("import:email.regexWarning.title")}</p>
          <p className="whitespace-pre-line">{t("import:email.regexWarning.body")}</p>
        </div>
      )}

      {showLoader ? (
        <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 flex items-center justify-center min-h-[220px]">
          <GlobeLoader size={140} label={t("common:loading.default")} />
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDropState("over");
          }}
          onDragLeave={() => setDropState("idle")}
          onClick={() => fileInputRef.current?.click()}
          className={[
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors min-h-[220px] flex flex-col items-center justify-center",
            dropState === "over"
              ? "border-blue-400 bg-blue-950/20"
              : "border-slate-600 hover:border-slate-400",
          ].join(" ")}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedExtensions.join(",")}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                void handleFile(e.target.files[0]);
                e.target.value = "";
              }
            }}
          />
          <div className="text-3xl mb-2">📧</div>
          <p className="font-medium text-slate-200">{t("import:email.dropZone")}</p>
          <p className="text-sm text-slate-400 mt-1">{acceptedExtensions.join(", ")}</p>
        </div>
      )}

      <details className="text-sm text-slate-400">
        <summary className="cursor-pointer hover:text-slate-200">
          {t("import:email.textFallback")}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            className="w-full h-32 bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 resize-none"
            placeholder={t("import:email.textPlaceholder")}
          />
          <button
            type="button"
            onClick={() => void handleTextParse()}
            disabled={!emailText.trim() || showLoader}
            className="btn-primary self-end px-4 py-2 text-sm"
          >
            {t("import:email.parse")}
          </button>
        </div>
      </details>
    </div>
  );
}
