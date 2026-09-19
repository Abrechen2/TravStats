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
 * The answer is cached for the tab. It is instance configuration, it changes
 * only when an admin changes it, and every trip page would otherwise ask
 * again.
 */
let cached: boolean | null = null;
let inFlight: Promise<boolean | null> | null = null;

async function fetchHasLlm(): Promise<boolean | null> {
  if (cached !== null) return cached;
  inFlight ??= api
    .get<{ hasLlm: boolean }>("/parser-capabilities")
    .then(({ data }) => {
      cached = Boolean(data?.hasLlm);
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

/** `true` / `false` once known, `null` while the answer is still outstanding. */
export function useHasLlm(): boolean | null {
  const [hasLlm, setHasLlm] = useState<boolean | null>(cached);

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
