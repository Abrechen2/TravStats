import type { ParserConfig } from "./types";
import { getParserConfig } from "./config";
import { getOllamaTextParser } from "./text/ollamaTextParser";

/**
 * ONE answer to "could the LLM have read this document?", for every domain.
 *
 * `ollamaAvailable` travels out of `/parse-email`, `/parse-pdf`,
 * `/parse-email-file` and `/parse-image` for flights, cruises and lodging
 * alike, and until this file existed each domain computed it differently:
 *
 *  - the flight parser read `config.textFallbacks.includes("ollama")`, which is
 *    a CONFIGURATION fact and, worse, one that is true on a default install
 *    whether or not an Ollama exists. Measured on the beta of 2026-09-19: every
 *    flight parse answered `ollamaAvailable: true` while `GET /settings/parser`
 *    reported `textProvider: "regex"` and `parserUsed` came back `"regex"`
 *    every single time — the field said the model had been an option when no
 *    model had ever been contacted;
 *  - the cruise and lodging parsers hardcoded `false` on their template-first
 *    hit, so the SAME instance answered the opposite for a cruise mail.
 *
 * Two domains, two answers, one question. The field keeps its name for API
 * compatibility and now means what this module measures:
 *
 *   the LLM was CONFIGURED for this caller, and it ANSWERED its last health
 *   probe (at most 60 s old).
 *
 * "For this caller" carries the shared-demo denial: `getParserConfig` drops
 * `ollama` from the fallback chain for that account, so the answer here is
 * false for it even on an instance whose model is up — which is exactly what
 * that account experiences.
 */

/**
 * How long a probe result stands in for the next question.
 *
 * The probe is a live HTTP GET against `/api/tags` with a 5 s timeout, and a
 * parse can ask for the answer on a path that never talks to the model at all
 * (a template hit). Re-probing per request would put a network round trip —
 * and, when the configured host is down, a 5 s stall — in front of the fastest
 * path we have. 60 s is short enough that an admin who has just fixed the URL
 * sees it, and long enough that a burst import probes once.
 */
const PROBE_TTL_MS = 60_000;

interface ProbeResult {
  reachable: boolean;
  probedAt: number;
}

/** Keyed by endpoint URL, because the endpoint is what the probe measures. */
const probeCache = new Map<string, ProbeResult>();

/**
 * Probes in flight, coalesced per endpoint. Two parses starting together must
 * not both stall on the same unreachable host — the same reason
 * `airlineLogo/logoCache.ts` coalesces its refreshes.
 */
const inFlightProbes = new Map<string, Promise<boolean>>();

/**
 * Feed an already-performed probe into the shared cache.
 *
 * The cruise and lodging pipelines probe the endpoint themselves before they
 * call the model, and that probe IS the health probe this module reports on.
 * Recording it keeps the domains on one measurement instead of two that can
 * disagree, and saves the duplicate round trip.
 */
export function recordLlmProbe(url: string, reachable: boolean): void {
  probeCache.set(url, { reachable, probedAt: Date.now() });
}

/** Test seam: forget every probe, so the next question is measured again. */
export function clearLlmAvailabilityCache(): void {
  probeCache.clear();
  inFlightProbes.clear();
}

async function isReachable(url: string): Promise<boolean> {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.probedAt < PROBE_TTL_MS) return cached.reachable;

  const pending = inFlightProbes.get(url);
  if (pending) return pending;

  // The model name is irrelevant to `/api/tags` — it asks whether the server
  // answers at all — so the parser is built with the URL alone.
  const probe = getOllamaTextParser(url)
    .checkAvailability()
    .then((availability) => {
      recordLlmProbe(url, availability.available);
      return availability.available;
    })
    .finally(() => inFlightProbes.delete(url));

  inFlightProbes.set(url, probe);
  return probe;
}

/**
 * The answer for an already-resolved parser configuration — what the flight
 * pipeline holds by the time it needs it, so it costs no second settings read.
 */
export async function isLlmAvailableForConfig(config: ParserConfig): Promise<boolean> {
  if (!config.textFallbacks.includes("ollama")) return false;
  if (!config.ollamaUrl || !config.ollamaModel) return false;
  return isReachable(config.ollamaUrl);
}

export interface LlmAvailabilityQuery {
  /** Whose parse this is — decides the shared-demo denial. */
  userId?: string;
  /**
   * An endpoint the caller has already resolved, overriding the configured
   * one. The cruise and lodging parsers accept explicit options that win over
   * admin settings; asking about the configured endpoint while parsing against
   * another would report on a host this parse never touched.
   */
  url?: string;
  model?: string;
}

export async function isLlmAvailable(query: LlmAvailabilityQuery = {}): Promise<boolean> {
  const config = await getParserConfig(undefined, undefined, query.userId);
  return isLlmAvailableForConfig({
    ...config,
    ...(query.url !== undefined ? { ollamaUrl: query.url } : {}),
    ...(query.model !== undefined ? { ollamaModel: query.model } : {}),
  });
}
