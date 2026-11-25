/**
 * "KI fragen" for an ambiguous GPS stay (forgejo#439 phase 2): the run behind
 * `POST /dawarich-stays/:id/ai-help`.
 *
 * Three gates, in this order, and each answers as itself:
 *  1. the admin's catalogue switch `aiSuggestionHelp` (off by default) and the
 *     internet master switch;
 *  2. a model the account may use at all (`resolveLlmTarget` — a local Ollama
 *     counts, a cloud slot only with the admin's opt-in and the account's AI
 *     consent);
 *  3. the account's confirmation of THIS target (`useConsent.ts`): without
 *     it the run returns the disclosure and sends nothing.
 * Only then is the minimal payload (`payload.ts`) sent. The answer is advice:
 * nothing here writes to the stay, a place or a visit.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { localDay } from "../../shared/time/instant";
import { haversineKm } from "../../shared/geo/haversine";
import { stayIdentityFor } from "../dawarich/stays/identity";
import { isEnabled, loadAdminState } from "../externalServices/adminView";
import { getService } from "../externalServices/catalogue";
import {
  hostOf,
  locationOf,
  requireUseConsent,
  type Disclosure,
  type UseConfirmation,
} from "../externalServices/useConsent";
import { internetAllowed } from "../internetGate";
import { llmGenerate, resolveLlmTarget, type LlmTarget } from "../llm/llmProvider";
import {
  HELP_SYSTEM,
  SUGGESTION_HELP_FIELDS,
  helpPayload,
  helpPrompt,
  parseHelpAnswer,
  type SuggestionHelpAnswer,
  type SuggestionHelpInput,
} from "./payload";

export const AI_HELP_TIMEOUT_MS = 45_000;
const NEARBY_RADIUS_KM = 1;

export type AiHelpFailure =
  | "serviceOff"
  | "internetOff"
  | "noProvider"
  | "notAmbiguous"
  | "providerConsent"
  | "providerOff"
  | "timeout"
  | "unreachable"
  | "providerError"
  | "badAnswer";

export class AiHelpError extends Error {
  constructor(readonly reason: AiHelpFailure) {
    super(`AI help failed: ${reason}`);
    this.name = "AiHelpError";
  }
}

export type AiHelpProvider = {
  kind: string;
  model: string;
  host: string;
  location: "cloud" | "lan";
};

export type AiHelpOutcome =
  | { kind: "confirm"; disclosure: Disclosure }
  | { kind: "answer"; answer: SuggestionHelpAnswer; provider: AiHelpProvider };

/** Whether the button may be shown: the switch is on and some model is usable. */
export async function aiHelpAvailability(
  userId: string
): Promise<{ available: boolean; reason: AiHelpFailure | null }> {
  try {
    await gate(userId);
    return { available: true, reason: null };
  } catch (error) {
    if (error instanceof AiHelpError) return { available: false, reason: error.reason };
    throw error;
  }
}

async function gate(userId: string): Promise<LlmTarget> {
  const service = getService("aiSuggestionHelp");
  if (!service || !isEnabled(service, await loadAdminState())) throw new AiHelpError("serviceOff");
  if (!(await internetAllowed())) throw new AiHelpError("internetOff");
  const target = await resolveLlmTarget({ userId });
  if (!target) throw new AiHelpError("noProvider");
  return target;
}

function providerOf(target: LlmTarget): AiHelpProvider {
  return {
    kind: target.kind ?? "ollama",
    model: target.model,
    host: hostOf(target.url),
    location: locationOf(target.url),
  };
}

async function inputOf(userId: string, stayId: string): Promise<SuggestionHelpInput> {
  const stay = await prisma.dawarichStay.findFirst({
    where: { id: stayId, userId },
    select: { id: true, lat: true, lon: true, startAt: true, endAt: true, zone: true },
  });
  if (!stay) throw new AppError("Finding not found", 404);
  const identity = await stayIdentityFor(userId, stayId);
  const candidates = identity.candidates.map((c) => c.name).filter((n) => n.trim().length > 0);
  if (candidates.length < 2) throw new AiHelpError("notAmbiguous");
  const places = await prisma.place.findMany({
    where: {
      userId,
      lat: { gte: stay.lat - 0.02, lte: stay.lat + 0.02 },
      lon: { gte: stay.lon - 0.03, lte: stay.lon + 0.03 },
    },
    select: { name: true, lat: true, lon: true },
    take: 50,
  });
  const nearby = places
    .map((p) => ({ name: p.name, km: haversineKm(stay, p) }))
    .filter((p) => p.km <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .map((p) => p.name);
  const nearest = identity.candidates.reduce<number | null>(
    (m, c) => (m === null || c.distanceM < m ? c.distanceM : m),
    null
  );
  return {
    candidates,
    distanceM: nearest,
    dwellMin: (stay.endAt.getTime() - stay.startAt.getTime()) / 60_000,
    nearbyPlaces: nearby,
    localDay: localDay(stay.startAt, stay.zone),
  };
}

function failureOf(error: unknown): AiHelpFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "LLM_CLOUD_NOT_CONSENTED") return "providerConsent";
  if (code === "LLM_DISABLED" || code === "LLM_REQUEST_POLICY") return "providerOff";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/returned HTTP|Invalid .* response|not a string/i.test(message)) return "providerError";
  return "unreachable";
}

export async function askStayAiHelp(
  userId: string,
  stayId: string,
  confirmation: UseConfirmation | undefined,
  generate: typeof llmGenerate = llmGenerate
): Promise<AiHelpOutcome> {
  const target = await gate(userId);
  const payload = helpPayload(await inputOf(userId, stayId));
  const provider = providerOf(target);
  const verdict = await requireUseConsent(
    userId,
    {
      serviceId: "aiSuggestionHelp",
      host: provider.host,
      provider: provider.kind,
      location: provider.location,
      fields: [...SUGGESTION_HELP_FIELDS],
      pointCount: 0,
      privacyZonesApplied: null,
    },
    confirmation
  );
  if (!verdict.ok) return { kind: "confirm", disclosure: verdict.disclosure };

  let text: string;
  try {
    text = await generate(target, {
      system: HELP_SYSTEM,
      prompt: helpPrompt(payload),
      temperature: 0,
      json: true,
      timeoutMs: AI_HELP_TIMEOUT_MS,
      label: "Suggestion help",
      userId,
    });
  } catch (error) {
    throw new AiHelpError(failureOf(error));
  }
  const answer = parseHelpAnswer(text, payload.candidates);
  if (!answer) throw new AiHelpError("badAnswer");
  return { kind: "answer", answer, provider };
}
