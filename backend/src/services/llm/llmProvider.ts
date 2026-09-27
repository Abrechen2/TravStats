/**
 * The language-model provider — ONE place that knows how to reach a model.
 *
 * Every caller that asks a model something — the flight, lodging, cruise and
 * rail parsers (and through them the document import), the CSV mapping
 * suggestion and the trip summary — resolves its target here, probes it here
 * and generates here. Until beta.17 each of the six carried its own resolution
 * (admin → env → localhost), its own `/api/generate` request and its own
 * `/api/tags` probe; adding a second provider to six copies would have made
 * twelve. There is one now, with two protocols behind it:
 *
 *  - `ollama` — Ollama's native API (`/api/generate`, `/api/tags`), the
 *    default and what every instance used before.
 *  - `openai_compatible` — any `/chat/completions` endpoint (OpenAI,
 *    OpenRouter, Ollama Cloud, a LAN vLLM/LM Studio), with an optional bearer
 *    key. The base URL includes its version path (`https://api.openai.com/v1`).
 *
 * Both get the same prompts, the same temperatures and — for Ollama, the only
 * protocol that lets a client choose it — ONE context window, `LLM_NUM_CTX`.
 * Ollama keys a loaded model on its `num_ctx`: two callers asking for
 * different sizes make every alternation unload and reload the model (9.9 GB).
 * Measured against the owner's host on 2026-08-16: a request that matched the
 * loaded instance answered in 7 s, one that forced a reload did not answer
 * within 240 s — which is why a hotel confirmation timed out whenever a flight
 * had been parsed before it. The CSV mapping suggestion asked for 4096 until
 * this file existed, and paid that reload too.
 *
 * Nothing here logs a prompt, a document, a model answer or a key. Errors name
 * the protocol, the HTTP status or the failure kind — never the body.
 */

import { requestTextWithDeadline } from "../http/boundedHttp";
import { LLM_AVAILABILITY_TIMEOUT_MS, LLM_MAX_RESPONSE_BYTES } from "../http/llmTimeout";
import { getAdminParserSettings } from "../parserSettings";
import logger from "../../utils/logger";
import { assertLlmCloudConsent, assertLlmEnabled } from "./llmGate";
import { checkLlmBaseUrl, isLocalLlmHost, llmHostOf } from "./llmEndpoint";

export const LLM_PROVIDER_KINDS = ["ollama", "openai_compatible"] as const;
export type LlmProviderKind = (typeof LLM_PROVIDER_KINDS)[number];

/** The one context window every model request asks Ollama for. */
export const LLM_NUM_CTX = 8192;

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma3:12b";

/**
 * Where a request goes. `kind` absent means Ollama — the shape every caller
 * and test used before there was a second provider.
 */
export interface LlmTarget {
  kind?: LlmProviderKind;
  url: string;
  model: string;
  /** Bearer key for an OpenAI-compatible endpoint. Never logged, never returned. */
  apiKey?: string;
  /** The host is outside the local network — a request needs the cloud opt-in. */
  isCloud?: boolean;
}

/**
 * What a response may say about the provider that read a document. The host
 * is named only for a cloud provider — that is the disclosure a user needs
 * ("this went to api.openai.com"); a LAN address is instance internals.
 */
export interface LlmProviderInfo {
  kind: LlmProviderKind;
  model: string;
  isCloud: boolean;
  host: string | null;
}

export function isLlmProviderKind(value: unknown): value is LlmProviderKind {
  return typeof value === "string" && (LLM_PROVIDER_KINDS as readonly string[]).includes(value);
}

function kindOf(target: LlmTarget): LlmProviderKind {
  return target.kind ?? "ollama";
}

function isCloudUrl(url: string): boolean {
  try {
    return !isLocalLlmHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** An Ollama target from explicit values, falling back to the environment and the defaults. */
export function ollamaTarget(url?: string, model?: string): LlmTarget {
  const resolvedUrl = url ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  return {
    kind: "ollama",
    url: resolvedUrl,
    model: model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    isCloud: isCloudUrl(resolvedUrl),
  };
}

export interface ResolveLlmTargetOptions {
  /** Explicit Ollama endpoint (tests, legacy callers). Wins over the settings. */
  url?: string;
  model?: string;
  /**
   * Fill a missing Ollama URL/model with localhost/gemma3 (what the domain
   * parsers always did). Without it an unconfigured instance resolves to null
   * — "no model" — which is what `getParserConfig` needs to answer.
   */
  withDefaults?: boolean;
}

/**
 * The target a model request goes to: explicit options over the admin's
 * provider choice over the environment over the defaults. Null when no model
 * is configured, or when OpenAI-compatible is chosen but incomplete — which
 * `llmRefusalFor` reports with a reason before any pipeline gets here.
 */
export async function resolveLlmTarget(
  options: ResolveLlmTargetOptions = {}
): Promise<LlmTarget | null> {
  let admin: Awaited<ReturnType<typeof getAdminParserSettings>> = null;
  try {
    admin = await getAdminParserSettings();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[LLM] Failed to load admin parser settings"
    );
  }

  if (options.url !== undefined || options.model !== undefined) {
    return ollamaTarget(
      options.url ?? admin?.ollamaUrl ?? undefined,
      options.model ?? admin?.ollamaModel ?? undefined
    );
  }

  if (admin?.llmProvider === "openai_compatible") {
    const check = admin.openaiCompatBaseUrl ? checkLlmBaseUrl(admin.openaiCompatBaseUrl) : null;
    if (!check?.ok || !admin.openaiCompatModel) return null;
    return {
      kind: "openai_compatible",
      url: check.url,
      model: admin.openaiCompatModel,
      ...(admin.openaiCompatApiKey ? { apiKey: admin.openaiCompatApiKey } : {}),
      isCloud: !check.isLocal,
    };
  }

  const url =
    admin?.ollamaUrl ??
    process.env.OLLAMA_URL ??
    (options.withDefaults ? DEFAULT_OLLAMA_URL : undefined);
  const model =
    admin?.ollamaModel ??
    process.env.OLLAMA_MODEL ??
    (options.withDefaults ? DEFAULT_OLLAMA_MODEL : undefined);
  if (!url || !model) return null;
  return ollamaTarget(url, model);
}

export function describeLlmTarget(target: LlmTarget): LlmProviderInfo {
  const isCloud = target.isCloud ?? isCloudUrl(target.url);
  return {
    kind: kindOf(target),
    model: target.model,
    isCloud,
    host: isCloud ? llmHostOf(target.url) || null : null,
  };
}

/** What a caller names in its own error/log lines — protocol, not endpoint. */
export function llmProviderLabel(target: LlmTarget): string {
  return kindOf(target) === "ollama" ? "Ollama" : "OpenAI-compatible provider";
}

function authHeaders(target: LlmTarget): Record<string, string> {
  return target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {};
}

/**
 * Parse a provider envelope WITHOUT surfacing it: V8's SyntaxError embeds a
 * snippet of the input, and the input here is a model answer about somebody's
 * booking mail.
 */
function parseEnvelope(raw: string, failure: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(failure);
  }
}

export interface LlmGenerateRequest {
  system: string;
  prompt: string;
  temperature: number;
  /**
   * Ask for a JSON object (Ollama `format: "json"`, OpenAI
   * `response_format: json_object`). Only for callers whose answer IS an
   * object: the flight parser expects a top-level array and leaves it off.
   */
  json: boolean;
  timeoutMs: number;
  /** Error-message label for Ollama; defaults to "Ollama request". */
  label?: string;
}

/**
 * The two gates, in front of each request this module can send: the admin
 * switch and the cloud consent. A pipeline that forgot to ask `llmRefusalFor`
 * fails closed here instead of sending the document
 * (`llmGate.entryPoints.test.ts` holds that every model endpoint in the source
 * sits behind them).
 */
async function assertMayAsk(target: LlmTarget): Promise<void> {
  await assertLlmEnabled();
  await assertLlmCloudConsent({ isCloud: target.isCloud ?? isCloudUrl(target.url) });
}

async function generateWithOllama(target: LlmTarget, req: LlmGenerateRequest): Promise<string> {
  await assertMayAsk(target);
  // `think: false` disables chain-of-thought on reasoning models like qwen3;
  // older Ollama versions ignore it.
  const body = JSON.stringify({
    model: target.model,
    system: req.system,
    prompt: req.prompt,
    stream: false,
    think: false,
    ...(req.json ? { format: "json" } : {}),
    options: { temperature: req.temperature, num_ctx: LLM_NUM_CTX },
  });
  const raw = await requestTextWithDeadline({
    url: `${target.url}/api/generate`,
    method: "POST",
    body,
    timeoutMs: req.timeoutMs,
    maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
    label: req.label ?? "Ollama request",
  });
  const envelope = parseEnvelope(raw, "Invalid Ollama response structure");
  if (typeof envelope !== "object" || envelope === null || !("response" in envelope)) {
    throw new Error("Invalid Ollama response structure");
  }
  const text = (envelope as Record<string, unknown>).response;
  if (typeof text !== "string") throw new Error("Ollama response.response is not a string");
  return text;
}

async function generateWithOpenAi(target: LlmTarget, req: LlmGenerateRequest): Promise<string> {
  await assertMayAsk(target);
  const body = JSON.stringify({
    model: target.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ],
    temperature: req.temperature,
    stream: false,
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
  });
  const raw = await requestTextWithDeadline({
    url: `${target.url}/chat/completions`,
    method: "POST",
    body,
    headers: authHeaders(target),
    timeoutMs: req.timeoutMs,
    maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
    label: "OpenAI-compatible request",
  });
  const failure = "Invalid OpenAI-compatible response structure";
  const envelope = parseEnvelope(raw, failure);
  const choices =
    typeof envelope === "object" && envelope !== null
      ? (envelope as Record<string, unknown>).choices
      : undefined;
  const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
  const message =
    typeof first === "object" && first !== null
      ? (first as Record<string, unknown>).message
      : undefined;
  const content =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>).content
      : undefined;
  if (typeof content !== "string") throw new Error(failure);
  return content;
}

/**
 * Ask the model. Returns its raw text answer (think blocks and code fences
 * are the caller's to strip — each reads a different shape out of it). Both
 * protocols pass `assertMayAsk` before anything is sent.
 */
export async function llmGenerate(target: LlmTarget, req: LlmGenerateRequest): Promise<string> {
  return kindOf(target) === "ollama"
    ? generateWithOllama(target, req)
    : generateWithOpenAi(target, req);
}

export interface LlmProbeResult {
  reachable: boolean;
  /** Model names the endpoint lists (empty when it did not answer). */
  models: string[];
  /** Why it is not reachable — protocol and status only, never a body. */
  error?: string;
}

function namesFrom(list: unknown, key: "name" | "id"): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)[key]
        : undefined
    )
    .filter((name): name is string => typeof name === "string");
}

/**
 * Is the endpoint up? Ollama: `GET /api/tags`; OpenAI-compatible:
 * `GET /models` with the key. Neither carries a document, so a probe needs no
 * cloud consent — it is what "Verbindung testen" runs before the admin opts in.
 */
export async function llmProbe(target: LlmTarget): Promise<LlmProbeResult> {
  const ollama = kindOf(target) === "ollama";
  try {
    const raw = await requestTextWithDeadline({
      url: ollama ? `${target.url}/api/tags` : `${target.url}/models`,
      method: "GET",
      headers: authHeaders(target),
      timeoutMs: LLM_AVAILABILITY_TIMEOUT_MS,
      maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
      label: ollama ? "Ollama availability check" : "OpenAI-compatible availability check",
    });
    const parsed = parseEnvelope(raw, "Unexpected response format");
    const listKey = ollama ? "models" : "data";
    if (typeof parsed !== "object" || parsed === null || !(listKey in parsed)) {
      return { reachable: false, models: [], error: "Unexpected response format" };
    }
    const list = (parsed as Record<string, unknown>)[listKey];
    return { reachable: true, models: namesFrom(list, ollama ? "name" : "id") };
  } catch (err) {
    return {
      reachable: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
