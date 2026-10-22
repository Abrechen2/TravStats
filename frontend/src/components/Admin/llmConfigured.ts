import type { ParserSettingsData } from "./ParserSettings";

/**
 * Whether any language model can be asked for a booking: the switch is on and
 * at least one slot has somewhere to go — an Ollama with a model, or a cloud
 * slot with a key and the admin's consent, or a custom endpoint (a remote one
 * needing that consent too). For the "KI-Parser" row in Externe Dienste
 * (forgejo#321 prototype), which reads it rather than restating the parser page.
 */
export function isLlmConfigured(p: ParserSettingsData): boolean {
  if (p.llmEnabled === false) return false;
  if (p.ollamaUrl && p.ollamaModel) return true;
  if (p.llmOpenaiApiKey && p.llmOpenaiOptIn) return true;
  if (p.llmAnthropicApiKey && p.llmAnthropicOptIn) return true;
  if (p.llmGoogleApiKey && p.llmGoogleOptIn) return true;
  if (p.openaiCompatBaseUrl && (!p.openaiCompatIsCloud || p.llmCustomOptIn)) return true;
  return false;
}
