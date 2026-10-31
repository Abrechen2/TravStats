import type { ParserSettingsData } from "./ParserSettings";

/**
 * What the Parser page's Save may write: how a booking is read (order, model
 * switch, the cloud chain's order) and the Ollama model it picks. Addresses,
 * keys, consent and switches belong to Externe Dienste; sending the page's
 * copy of them would overwrite an edit made there since this page loaded
 * (a stale URL, a stale masked key) without any message.
 *
 * The model is also edited in Externe Dienste, so it is sent only when the user
 * changed it on this page, i.e. when it differs from the copy the page loaded
 * (`loaded`). Without a baseline it is always sent.
 */
export function parserOwnFields(
  settings: ParserSettingsData,
  loaded?: ParserSettingsData | null
): {
  parserOrder?: ParserSettingsData["parserOrder"];
  llmEnabled?: boolean;
  llmProviderOrder?: ParserSettingsData["llmProviderOrder"];
  ollamaModel?: string | null;
} {
  return {
    ...(settings.parserOrder !== undefined ? { parserOrder: settings.parserOrder } : {}),
    ...(settings.llmEnabled !== undefined ? { llmEnabled: settings.llmEnabled } : {}),
    ...(settings.llmProviderOrder !== undefined
      ? { llmProviderOrder: settings.llmProviderOrder }
      : {}),
    ...(!loaded || settings.ollamaModel !== loaded.ollamaModel
      ? { ollamaModel: settings.ollamaModel }
      : {}),
  };
}
