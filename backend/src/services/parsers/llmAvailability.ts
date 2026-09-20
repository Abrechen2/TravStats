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
 *   probe.
 *
 * The probe is refreshed in the background, never awaited — see
 * `refreshProbeIfStale`. A question asked before the first probe has come back
 * is answered `false`, and the call after it has landed says what it found.
 *
 * "For this caller" carries the shared-demo denial: `getParserConfig` drops
 * `ollama` from the fallback chain for that account, so the answer here is
 * false for it even on an instance whose model is up — which is exactly what
 * that account experiences.
 */

/**
 * How long a probe result stands before it is refreshed.
 *
 * Short enough that an admin who has just fixed the URL sees it within a
 * minute, long enough that a burst import probes once.
 */
const PROBE_TTL_MS = 60_000;

interface ProbeResult {
  reachable: boolean;
  probedAt: number;
}

/** Keyed by endpoint URL, because the endpoint is what the probe measures. */
const probeCache = new Map<string, ProbeResult>();

/**
 * Probes in flight, coalesced per endpoint. A burst of parses must kick ONE
 * refresh, not one each — the same reason `airlineLogo/logoCache.ts`
 * coalesces its refreshes per key.
 */
const inFlightProbes = new Map<string, Promise<void>>();

/**
 * Feed an already-performed probe into the shared cache.
 *
 * The cruise and lodging pipelines probe the endpoint themselves before they
 * call the model — there the wait is the point, because the very next thing
 * they do is talk to it. That probe IS the health probe this module reports
 * on, so recording it keeps the domains on one measurement instead of two
 * that can disagree, and saves the duplicate round trip.
 */
export function recordLlmProbe(url: string, reachable: boolean): void {
  probeCache.set(url, { reachable, probedAt: Date.now() });
}

/** Test seam: forget every probe, so the next question is measured again. */
export function clearLlmAvailabilityCache(): void {
  probeCache.clear();
  inFlightProbes.clear();
}

/**
 * Test seam: wait for every probe this module has in flight.
 *
 * Production never needs this — nothing waits for a probe on purpose. A test
 * that wants the SECOND answer, the one a refreshed cache gives, would
 * otherwise have to sleep and guess.
 */
export async function settleLlmProbes(): Promise<void> {
  while (inFlightProbes.size > 0) {
    await Promise.all([...inFlightProbes.values()]);
  }
}

/**
 * Start a probe if the cached answer is missing or older than the TTL.
 *
 * Fire-and-forget, deliberately: this is stale-while-revalidate, the shape
 * `airlineLogo/logoCache.ts` already uses. Awaiting it here would put a
 * network round trip on the response path of a parse that may never talk to
 * the model at all — a pure-regex flight parse, or a cruise/lodging template
 * hit. With the endpoint configured but DOWN that is a 5 s stall (the
 * `/api/tags` timeout) on the fastest path we have, once a minute, to answer
 * a boolean that is only ever advisory. So nothing ever awaits a probe to
 * produce a response; the answer improves by one call instead.
 */
function refreshProbeIfStale(url: string): void {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.probedAt < PROBE_TTL_MS) return;
  if (inFlightProbes.has(url)) return;

  // The model name is irrelevant to `/api/tags` — it asks whether the server
  // answers at all — so the parser is built with the URL alone.
  const probe = getOllamaTextParser(url)
    .checkAvailability()
    .then((availability) => recordLlmProbe(url, availability.available))
    // `checkAvailability` already swallows its own errors, but an unhandled
    // rejection from a background task would take the process down. A probe
    // that failed to answer is a probe that answered "not reachable".
    .catch(() => recordLlmProbe(url, false))
    .finally(() => inFlightProbes.delete(url));

  inFlightProbes.set(url, probe);
}

/**
 * The answer for an already-resolved parser configuration — what the flight
 * pipeline holds by the time it needs it, so it costs no second settings read.
 *
 * Synchronous, and that is the guarantee rather than a convenience: there is
 * no way for this to wait on the network, so no caller can accidentally make
 * it do so. A cold cache answers `false` — "no model has answered" — which is
 * also what an instance with no model configured says, and is the safe
 * direction: it understates the model rather than promising one.
 */
export function isLlmAvailableForConfig(config: ParserConfig): boolean {
  if (!config.textFallbacks.includes("ollama")) return false;
  if (!config.ollamaUrl || !config.ollamaModel) return false;
  refreshProbeIfStale(config.ollamaUrl);
  return probeCache.get(config.ollamaUrl)?.reachable ?? false;
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

/**
 * Asynchronous only because it reads the parser settings; the availability
 * answer itself still costs no network — see `isLlmAvailableForConfig`.
 */
export async function isLlmAvailable(query: LlmAvailabilityQuery = {}): Promise<boolean> {
  const config = await getParserConfig(undefined, undefined, query.userId);
  return isLlmAvailableForConfig({
    ...config,
    ...(query.url !== undefined ? { ollamaUrl: query.url } : {}),
    ...(query.model !== undefined ? { ollamaModel: query.model } : {}),
  });
}
