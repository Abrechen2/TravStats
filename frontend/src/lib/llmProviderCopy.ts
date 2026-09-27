type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The language-model provider a parse result or `/parser-capabilities` names
 * (backend `services/llm/llmProvider.ts` → `LlmProviderInfo`). The host is
 * set only for a provider outside the local network — that is what a user
 * needs to know about where a booking went.
 */
export interface LlmProviderInfo {
  kind: "ollama" | "openai_compatible";
  model: string;
  isCloud: boolean;
  host: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The field as the server sent it, or null when absent or malformed. */
export function parseLlmProviderInfo(value: unknown): LlmProviderInfo | null {
  if (!isRecord(value)) return null;
  const { kind, model, isCloud, host } = value;
  if (kind !== "ollama" && kind !== "openai_compatible") return null;
  if (typeof model !== "string" || typeof isCloud !== "boolean") return null;
  return { kind, model, isCloud, host: typeof host === "string" && host ? host : null };
}

/**
 * The provider that read THIS document — only when the model did.
 * `parserUsed: "ollama"` is the API's historical name for "the language model
 * read it", whichever provider that was.
 */
export function llmProviderOfResult(result: unknown): LlmProviderInfo | null {
  if (!isRecord(result) || result.parserUsed !== "ollama") return null;
  return parseLlmProviderInfo(result.llmProvider);
}

/** "Gelesen vom KI-Modell … bei api.openai.com (Cloud-Anbieter)." */
export function readByMessage(info: LlmProviderInfo, t: Translate): string {
  return info.isCloud && info.host
    ? t("import:readBy.cloud", { model: info.model, host: info.host })
    : t("import:readBy.local", { model: info.model });
}

/** What the drop zone says BEFORE a document is sent. */
export function providerDisclosure(info: LlmProviderInfo, t: Translate): string {
  return info.isCloud && info.host
    ? t("import:email.provider.cloud", { model: info.model, host: info.host })
    : t("import:email.provider.local", { model: info.model });
}
