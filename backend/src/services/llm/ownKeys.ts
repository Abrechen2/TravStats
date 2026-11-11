import { resolveApiKey } from "../apiKeyResolver";
import type { CloudProviderKind } from "./llmEndpoint";

type FixedEndpointKind = Exclude<CloudProviderKind, "custom">;

/** The resolver's name for each fixed-endpoint cloud model. */
const OWN_KEY_PROVIDER = { openai: "openai", anthropic: "claude", google: "gemini" } as const;

/**
 * The cloud models this account brought its own key for (settings v3). The resolver applies the
 * admin's "no own keys" and "switched off" decisions, so a forbidden or paused key is simply absent.
 */
export async function ownLlmKeys(
  userId: string
): Promise<Partial<Record<FixedEndpointKind, string>>> {
  const found: Partial<Record<FixedEndpointKind, string>> = {};
  for (const kind of Object.keys(OWN_KEY_PROVIDER) as FixedEndpointKind[]) {
    const resolved = await resolveApiKey(OWN_KEY_PROVIDER[kind], userId);
    if (resolved.source === "user" && resolved.key) found[kind] = resolved.key;
  }
  return found;
}
