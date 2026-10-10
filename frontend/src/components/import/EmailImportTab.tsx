import { useState, useRef, useCallback, useEffect } from "react";
import type { JSX } from "react";
import { parseApi } from "../../lib/api";
import { api } from "../../lib/api/client";
import type { ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
import { useTranslation } from "../../hooks/useTranslation";
import { useMinLoadingState } from "../../hooks/useMinLoadingState";
import { GlobeLoader } from "../GlobeLoader";
import { logger } from "../../lib/logger";
import { parseFailureMessage } from "../../lib/parseErrorCopy";
import { fileToBase64 } from "../../lib/fileBase64";
import type { ParseableImportDomain } from "./types";
import type { ImportDocument } from "./documentHandoff";
import {
  parseLlmProviderInfo,
  providerDisclosure,
  type LlmProviderInfo,
} from "../../lib/llmProviderCopy";

/** What `/parser-capabilities` says about the model — absent fields are older backends. */
interface Capabilities {
  hasLlm: boolean;
  llmDisabledByAdmin?: boolean;
  llmRefusal?: string | null;
  llmProvider?: unknown;
}

type LlmState =
  | { kind: "unknown" }
  | { kind: "disabled" }
  | { kind: "cloudNotConsented" }
  | { kind: "providerIncomplete" }
  | { kind: "none" }
  | { kind: "available"; provider: LlmProviderInfo | null };

function llmStateOf(data: Capabilities | undefined): LlmState {
  if (!data) return { kind: "unknown" };
  if (data.llmDisabledByAdmin) return { kind: "disabled" };
  if (data.llmRefusal === "cloud_not_consented") return { kind: "cloudNotConsented" };
  if (data.llmRefusal === "provider_incomplete") return { kind: "providerIncomplete" };
  if (!data.hasLlm) return { kind: "none" };
  return { kind: "available", provider: parseLlmProviderInfo(data.llmProvider) };
}

interface EmailImportTabProps {
  /** Only a domain the backend can actually parse for — see `types.ts`. */
  domain: ParseableImportDomain;
  acceptedExtensions: string[];
  /**
   * The parsed result, plus the file it came from when there was one.
   *
   * Forgejo #19: the import log showed rows reading "Flüge · E-Mail ·
   * 30.8.2026 · 2 Flüge" with no way to tell them apart, because the batch was
   * created with `fileName: null`. After several imports on one day, reverting
   * the right one is guesswork. The name is null for pasted text, which has
   * no source file to name.
   */
  onEmailResult: (
    result: ParseEmailResult,
    fileName?: string | null,
    document?: ImportDocument
  ) => void;
  /**
   * Called when a `.pdf` is dropped in the email tab — kept for back-compat
   * with the flight workflow that auto-detects PDFs in this tab.
   */
  onPdfResult?: (
    result: ParsePdfResult,
    fileName?: string | null,
    document?: ImportDocument
  ) => void;
  onError: (message: string) => void;
  /**
   * A document another dialog handed over (D1): read once on mount, exactly
   * as if the user had dropped it here.
   */
  initialDocument?: ImportDocument | null;
}

type DropState = "idle" | "over" | "loading";

export default function EmailImportTab({
  domain,
  acceptedExtensions,
  onEmailResult,
  onPdfResult,
  onError,
  initialDocument = null,
}: EmailImportTabProps): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [dropState, setDropState] = useState<DropState>("idle");
  const [emailText, setEmailText] = useState("");
  // Each absence of the model is its own sentence to the person about to
  // import: none configured, switched off on purpose, a cloud provider the
  // admin has not agreed to, or an incomplete setup. And when a model IS
  // there, where the text goes — before it is sent (beta.17).
  const [llm, setLlm] = useState<LlmState>({ kind: "unknown" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showLoader = useMinLoadingState(dropState === "loading", 2000);

  useEffect(() => {
    api
      .get<Capabilities>("/parser-capabilities")
      .then(({ data }) => setLlm(llmStateOf(data)))
      .catch(() => setLlm({ kind: "unknown" }));
  }, []);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      const lowerName = file.name.toLowerCase();
      const isPdf = lowerName.endsWith(".pdf");

      if (isPdf && onPdfResult) {
        setDropState("loading");
        try {
          const pdfBase64 = await fileToBase64(file);
          // A package's document is kept: the commit files it on the trip.
          const result =
            domain === "package"
              ? await parseApi.parsePdf(pdfBase64, domain, { retain: true })
              : await parseApi.parsePdf(pdfBase64, domain);
          onPdfResult(result, file.name, { kind: "file", file });
        } catch (err) {
          logger.error("EmailImportTab: PDF parse failed", err);
          onError(parseFailureMessage(err, t, "import:pdf.parseError"));
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
        const result =
          domain === "package"
            ? await parseApi.parseEmailFile(file, domain, { retain: true })
            : await parseApi.parseEmailFile(file, domain);
        onEmailResult(result, file.name, { kind: "file", file });
      } catch (err) {
        logger.error("EmailImportTab: email file parse failed", err);
        onError(parseFailureMessage(err, t, "import:email.parseError"));
      } finally {
        setDropState("idle");
      }
    },
    [domain, acceptedExtensions, onEmailResult, onPdfResult, onError, t]
  );

  const parseText = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      setDropState("loading");
      try {
        const result = await parseApi.parseEmail(text, undefined, domain);
        // Pasted text has no source file, so the log row stays unnamed rather
        // than being given a made-up one.
        onEmailResult(result, null, { kind: "text", text });
      } catch (err) {
        logger.error("EmailImportTab: email text parse failed", err);
        onError(parseFailureMessage(err, t, "import:email.parseError"));
      } finally {
        setDropState("idle");
      }
    },
    [domain, onEmailResult, onError, t]
  );

  const handleTextParse = useCallback(
    (): Promise<void> => parseText(emailText),
    [emailText, parseText]
  );

  // A handed-over document is read once, on mount — a later re-render with
  // new callbacks must not parse it a second time.
  const handedOver = useRef(false);
  useEffect(() => {
    if (!initialDocument || handedOver.current) return;
    handedOver.current = true;
    if (initialDocument.kind === "file") void handleFile(initialDocument.file);
    else {
      setEmailText(initialDocument.text);
      void parseText(initialDocument.text);
    }
  }, [initialDocument, handleFile, parseText]);

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
      {llm.kind === "disabled" && (
        <div
          data-testid="llm-disabled-notice"
          className="text-sm text-(--text-muted) bg-(--bg-surface) border border-(--color-border) rounded-lg px-4 py-3"
        >
          <p className="font-medium mb-1">{t("import:email.llmDisabled.title")}</p>
          <p>{t("import:email.llmDisabled.body")}</p>
        </div>
      )}
      {(llm.kind === "cloudNotConsented" || llm.kind === "providerIncomplete") && (
        <div
          data-testid="llm-provider-refusal"
          className="text-sm text-amber-300 bg-amber-900/20 border border-amber-700 rounded-lg px-4 py-3"
        >
          <p className="font-medium mb-1">{t(`import:email.${llm.kind}.title`)}</p>
          <p>{t(`import:email.${llm.kind}.body`)}</p>
        </div>
      )}
      {llm.kind === "none" && (
        <div className="text-sm text-amber-300 bg-amber-900/20 border border-amber-700 rounded-lg px-4 py-3">
          <p className="font-medium mb-1">{t("import:email.regexWarning.title")}</p>
          <p className="whitespace-pre-line">{t("import:email.regexWarning.body")}</p>
        </div>
      )}
      {llm.kind === "available" && llm.provider && (
        <p data-testid="llm-provider-disclosure" className="text-xs text-(--text-muted)">
          {providerDisclosure(llm.provider, t)}
        </p>
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
          <div className="flex items-center justify-end gap-3">
            {/* Says WHY the button is off. It has been correctly disabled on an
                empty box for a while, which already ended the silent no-op the
                audit hit — but an unexplained disabled button is its own small
                dead end (forgejo#88 finding 8). */}
            {!emailText.trim() && (
              <p className="t-caption" style={{ color: "var(--text-muted)" }}>
                {t("import:email.pasteFirst")}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleTextParse()}
              disabled={!emailText.trim() || showLoader}
              className="btn-primary px-4 py-2 text-sm"
            >
              {t("import:email.parse")}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
