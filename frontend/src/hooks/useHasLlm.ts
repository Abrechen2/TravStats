import { useEffect, useState } from "react";
import { api } from "../lib/api/client";
import { logger } from "../lib/logger";

/**
 * Does this instance have a text model wired up at all?
 *
 * `GET /parser-capabilities` is public and answers from the SAME resolution
 * the parser itself uses (`getParserConfig`), which is the point: forgejo#12
 * is the record of what two sources of truth cost here — the import screen
 * said "Kein LLM-Parser verfügbar" while the next request came back labelled
 * `ollama` with 85 % confidence. Anything that wants to know whether to offer
 * an LLM action asks this, and never the admin parser settings, which an
 * ordinary user cannot read.
 *
 * Three states, not two. `null` is "not answered yet", and a caller must not
 * treat it as "no": drawing the honest "no model configured" card during the
 * one request a cold load spends waiting would tell the reader the opposite
 * of the truth for a moment, and flicker is how a true sentence becomes
 * untrustworthy.
 *
 * And a fourth: `"disabled"` — an admin switched the model off (Admin →
 * Parser, since 2026-09-25). It is falsy-for-generation like `false`, but the
 * sentence differs: "no model is set up" sends the reader to the admin,
 * "switched off" says templates-only is a decision rather than a fault. It
 * is a string rather than a second hook so every existing caller, and every
 * test that mocks this module with `() => true`, keeps working unchanged.
 *
 * The answer is cached for the tab. It is instance configuration, it changes
 * only when an admin changes it, and every trip page would otherwise ask
 * again.
 */
export type LlmAvailability = boolean | "disabled" | null;

let cached: LlmAvailability = null;
let inFlight: Promise<LlmAvailability> | null = null;

async function fetchHasLlm(): Promise<LlmAvailability> {
  if (cached !== null) return cached;
  inFlight ??= api
    .get<{ hasLlm: boolean; llmDisabledByAdmin?: boolean }>("/parser-capabilities")
    .then(({ data }) => {
      cached = data?.llmDisabledByAdmin ? "disabled" : Boolean(data?.hasLlm);
      return cached;
    })
    .catch((error: unknown) => {
      // Not cached: a failed request is not an answer, and the next caller
      // should be free to ask again.
      logger.warn("Failed to read the parser capabilities", error);
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** `true` / `false` / `"disabled"` once known, `null` while still outstanding. */
export function useHasLlm(): LlmAvailability {
  const [hasLlm, setHasLlm] = useState<LlmAvailability>(cached);

  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    void fetchHasLlm().then((value) => {
      if (!cancelled) setHasLlm(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return hasLlm;
}

/** Test seam: forget what this tab learned. */
export function resetHasLlmCache(): void {
  cached = null;
  inFlight = null;
}
