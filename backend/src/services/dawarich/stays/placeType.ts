import { z } from "zod";
import logger from "../../../utils/logger";
import { llmRefusalFor, type LlmRefusalKind } from "../../llm/llmGate";
import { describeLlmTarget, llmGenerateChain } from "../../llm/llmProvider";
import { readSuggestionSwitches } from "../../settings/suggestionSwitches";
import type { StayCandidate } from "./identityCombine";
import { stayAnchorOf, stayIdentityView } from "./identity";

/**
 * What kind of place a stay probably was, asked of a language model from the
 * NAMES of the places around it (forgejo#305). Opt-in per account
 * (`staySuggestions.llmPlaceClassification`, default off).
 *
 * What leaves the server is deliberately small: the candidate names and their
 * OSM categories — no coordinates, no address, no times. Even so the names say
 * where the user was, so the provider is chosen by the instance's own chain
 * (`llmGenerateChain`): a configured Ollama first, a cloud slot only where the
 * admin gave THAT slot its own consent, and nothing at all while the admin
 * switch is off. This switch never stands in for that consent.
 *
 * Every way it can fail is its own answer (refused / failed with a reason /
 * unusable answer), never an empty success.
 */

export const STAY_PLACE_TYPES = [
  "restaurant",
  "cafe",
  "bar",
  "accommodation",
  "shop",
  "museum",
  "attraction",
  "park",
  "nature",
  "beach",
  "religious",
  "transport",
  "venue",
  "sport",
  "residential",
  "workplace",
  "other",
] as const;
export type StayPlaceType = (typeof STAY_PLACE_TYPES)[number];

/** A short classification; the request may not wait like a document parse does. */
export const PLACE_TYPE_TIMEOUT_MS = 20_000;
export const PLACE_TYPE_TTL_MS = 60 * 60_000;
const PLACE_TYPE_CACHE_MAX = 500;

export type PlaceTypeFailure = "timeout" | "unavailable" | "unusable";

export type StayPlaceTypeResult =
  | { state: "off" }
  | { state: "noCandidates" }
  | { state: "refused"; refusal: LlmRefusalKind }
  | { state: "failed"; failure: PlaceTypeFailure }
  | {
      state: "ok";
      type: StayPlaceType;
      provider: { kind: string; isCloud: boolean; host: string | null };
    };

const answerSchema = z.object({ type: z.enum(STAY_PLACE_TYPES) });

const SYSTEM_PROMPT = [
  "You classify where a person spent time, from the names of the places nearest to that spot.",
  `Answer with one JSON object {"type": "<value>"} where <value> is exactly one of: ${STAY_PLACE_TYPES.join(", ")}.`,
  'Use "other" when the names do not decide it. No other text.',
].join("\n");

function promptOf(candidates: StayCandidate[]): string {
  const lines = candidates.map(
    (c, i) => `${i + 1}. ${c.name}${c.type ? ` (category: ${c.type})` : ""}`
  );
  return `Places nearest first by importance:\n${lines.join("\n")}`;
}

/** A model answer is untrusted text: fences stripped, then validated against the vocabulary. */
export function parsePlaceTypeAnswer(text: string): StayPlaceType | null {
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = answerSchema.safeParse(JSON.parse(stripped.slice(start, end + 1)));
    return parsed.success ? parsed.data.type : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, { result: StayPlaceTypeResult; expiresAt: number }>();

/** Test seam. */
export function clearStayPlaceTypeCache(): void {
  cache.clear();
}

function failureOf(error: unknown): PlaceTypeFailure {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message) ? "timeout" : "unavailable";
}

async function classify(userId: string, candidates: StayCandidate[]): Promise<StayPlaceTypeResult> {
  const refusal = await llmRefusalFor(userId);
  if (refusal) return { state: "refused", refusal: refusal.kind };
  try {
    const { text, target } = await llmGenerateChain(
      {
        system: SYSTEM_PROMPT,
        prompt: promptOf(candidates),
        temperature: 0,
        json: true,
        timeoutMs: PLACE_TYPE_TIMEOUT_MS,
        label: "Stay place-type request",
      },
      { withDefaults: true }
    );
    const type = parsePlaceTypeAnswer(text);
    if (!type) return { state: "failed", failure: "unusable" };
    const info = describeLlmTarget(target);
    return {
      state: "ok",
      type,
      provider: { kind: info.kind, isCloud: info.isCloud, host: info.host },
    };
  } catch (error) {
    const failure = failureOf(error);
    logger.warn({ failure }, "stay place type: classification failed");
    return { state: "failed", failure };
  }
}

export async function stayPlaceTypeFor(
  userId: string,
  stayId: string
): Promise<StayPlaceTypeResult> {
  const stay = await stayAnchorOf(userId, stayId);
  const switches = await readSuggestionSwitches(userId);
  if (!switches.staySuggestionsLlmPlaceClassification) return { state: "off" };
  const view = await stayIdentityView(userId, stay, switches.staySuggestionsImmichEvidence);
  if (view.candidates.length === 0) return { state: "noCandidates" };
  const key = JSON.stringify([userId, view.candidates.map((c) => [c.name, c.type])]);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.result;
  const result = await classify(userId, view.candidates);
  if (result.state === "ok") {
    if (cache.size >= PLACE_TYPE_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { result, expiresAt: Date.now() + PLACE_TYPE_TTL_MS });
  }
  return result;
}
