import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";
import { parseApi } from "../../lib/api";
import type { ParsePdfResult } from "../../lib/api/parse";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useMinLoadingState } from "../../hooks/useMinLoadingState";
import { GlobeLoader } from "../GlobeLoader";
import type { ImportDomain } from "./types";

interface PdfImportTabProps {
  domain: ImportDomain;
  onResult: (result: ParsePdfResult) => void;
  onError: (message: string) => void;
}

type DropState = "idle" | "over" | "loading";

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function PdfImportTab({
  domain,
  onResult,
  onError,
}: PdfImportTabProps): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [dropState, setDropState] = useState<DropState>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showLoader = useMinLoadingState(dropState === "loading", 2000);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        onError(t("import:pdf.notPdf"));
        return;
      }
      setDropState("loading");
      try {
        const pdfBase64 = await fileToBase64(file);
        const result = await parseApi.parsePdf(pdfBase64, domain);
        if (result.pdfTextLength === 0) {
          onError(t("import:pdf.emptyPdf"));
          return;
        }
        // Empty-result detection differs per domain; we delegate to caller.
        onResult(result);
      } catch (err) {
        logger.error("PdfImportTab: parse failed", err);
        onError(t("import:pdf.parseError"));
      } finally {
        setDropState("idle");
      }
    },
    [domain, onResult, onError, t]
  );

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
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                void handleFile(e.target.files[0]);
                e.target.value = "";
              }
            }}
          />
          <div className="text-3xl mb-2">📄</div>
          <p className="font-medium text-slate-200">{t("import:pdf.dropZone")}</p>
          <p className="text-sm text-slate-400 mt-1">.pdf</p>
        </div>
      )}
    </div>
  );
}
