import { consentDestination, type LlmProviderKind } from "../llm/llmEndpoint";

/** The endpoint a provider resolves to now, from the admin settings (and the Ollama env fallback). */
export function currentConsentDestination(
  admin: { ollamaUrl?: string | null; openaiCompatBaseUrl?: string | null } | null | undefined,
  provider: LlmProviderKind
): string | null {
  const url =
    provider === "ollama"
      ? admin?.ollamaUrl
      : provider === "custom"
        ? admin?.openaiCompatBaseUrl
        : null;
  return consentDestination(provider, url);
}
