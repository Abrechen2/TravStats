/**
 * The language-model provider — ONE place that knows how to reach a model.
 *
 * Every caller that asks a model something — the flight, lodging, cruise and
 * rail parsers (and through them the document import), the CSV mapping
 * suggestion and the trip summary — resolves its target here, probes it here
 * and generates here. Three protocols behind it:
 *
 *  - `ollama` — Ollama's native API (`/api/generate`, `/api/tags`), the
 *    default and what every instance used before.
 *  - The OpenAI-compatible `/chat/completions` shape, spoken by THREE kinds:
 *    `openai` (fixed `https://api.openai.com/v1`), `google` (fixed, Google's
 *    own OpenAI-compatible endpoint) and `custom` (a user-supplied base URL —
 *    OpenRouter, Ollama Cloud, a LAN vLLM/LM Studio; this is what beta.17
 *    shipped as `openai_compatible`). One request-building function serves
 *    all three — only the base URL and default model differ.
 *  - `anthropic` — Anthropic's native Messages API
 *    (`POST {url}/messages`, `x-api-key` + `anthropic-version` headers, the
 *    system prompt as a TOP-LEVEL field rather than a message).
 *
 * beta.18: this is no longer "one admin-picked active provider". It is a
 * FALLBACK CHAIN — `resolveLlmChain()` — Ollama first when it has an eligible
 * endpoint, then the enabled+consented cloud slots in the admin's own
 * priority order (`llm_provider_order`, default openai → anthropic → google
 * → custom). `resolveLlmTarget()` stays for callers that only want "the one
 * that would be tried first" (capability display, a pre-flight probe);
 * `llmGenerateChain()` is the one that actually cascades — ONLY on a
 * connectivity/protocol failure (network error, timeout, non-2xx, a body that
 * is not the protocol's shape). A slot that answers, however poor the
 * extraction, counts as served and the chain stops — never silently
 * substituting a "better-sounding" empty answer from a later slot without
 * saying so (owner rule 2026-09-26: a provider failure must never read as a
 * silent success). Every attempt and every failure is logged; a slot that was
 * never eligible (no key, no consent) is simply absent from the chain — no
 * log entry pretends it was tried.
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
import { getAdminParserSettings, type AdminParserSettings } from "../parserSettings";
import logger from "../../utils/logger";
import { assertLlmCloudConsent, assertLlmEnabled } from "./llmGate";
import {
  checkLlmBaseUrl,
  isLocalLlmHost,
  llmHostOf,
  CLOUD_PROVIDER_KINDS,
  isCloudProviderKind,
  type CloudProviderKind,
  type LlmProviderKind,
} from "./llmEndpoint";

export { LLM_PROVIDER_KINDS, isLlmProviderKind, type LlmProviderKind } from "./llmEndpoint";

/** The one context window every model request asks Ollama for. */
export const LLM_NUM_CTX = 8192;

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma3:12b";

/** Fixed base URLs for the two named cloud slots that reuse the OpenAI-compatible request shape. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
/** Anthropic's native Messages API base (`${url}/messages`). */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

/**
 * Sensible per-provider defaults, used when the admin leaves the model field
 * blank: a cost-effective model from each catalogue, not the flagship — this
 * is a parsing task (structured extraction from a booking mail), not a
 * conversation. Anthropic's alias form (`-latest`) is used deliberately so
 * the default keeps working as Anthropic retires dated snapshots.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
export const DEFAULT_GOOGLE_MODEL = "gemini-2.0-flash";

const ANTHROPIC_VERSION = "2023-06-01";
/** Generous for a structured-JSON extraction answer; Anthropic requires the field, unlike the other two protocols. */
const ANTHROPIC_MAX_TOKENS = 4096;

/**
 * Where a request goes. `kind` absent means Ollama — the shape every caller
 * and test used before there was a second provider.
 */
export interface LlmTarget {
  kind?: LlmProviderKind;
  url: string;
  model: string;
  /** Bearer key (OpenAI/Google/custom) or `x-api-key` (Anthropic). Never logged, never returned. */
  apiKey?: string;
  /** The host is outside the local network — a request needs that slot's own cloud opt-in. */
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
  /** Explicit Ollama endpoint (tests, legacy callers). Wins over the settings, bypasses the chain. */
  url?: string;
  model?: string;
  /**
   * Fill a missing Ollama URL/model with localhost/gemma3 (what the domain
   * parsers always did). Without it an unconfigured instance resolves to an
   * empty chain — "no model" — which is what `getParserConfig` needs to answer.
   */
  withDefaults?: boolean;
}

async function loadAdminSettings(): Promise<AdminParserSettings | null> {
  try {
    return await getAdminParserSettings();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[LLM] Failed to load admin parser settings"
    );
    return null;
  }
}

/**
 * Ollama's chain slot: eligible when it has an EXPLICITLY configured endpoint
 * (admin settings or `OLLAMA_URL`/`OLLAMA_MODEL`) and (is local, or the admin
 * allowed a remote one). Deliberately never falls back to the bare
 * `localhost:11434`/`gemma3:12b` defaults here — those are a last resort for
 * an entirely empty chain (`resolveLlmChain`'s `withDefaults` branch), not a
 * phantom Ollama that would jump ahead of an actually-configured, actually-
 * consented cloud slot just because nobody typed an Ollama URL.
 */
function ollamaChainTarget(admin: AdminParserSettings | null): LlmTarget | null {
  const url = admin?.ollamaUrl ?? process.env.OLLAMA_URL ?? undefined;
  const model = admin?.ollamaModel ?? process.env.OLLAMA_MODEL ?? undefined;
  if (!url || !model) return null;
  const target = ollamaTarget(url, model);
  if (target.isCloud && !(admin?.llmOllamaOptIn ?? false)) return null;
  return target;
}

type FixedEndpointKind = Exclude<CloudProviderKind, "custom">;

const FIXED_ENDPOINT: Record<FixedEndpointKind, { url: string; defaultModel: string }> = {
  openai: { url: OPENAI_BASE_URL, defaultModel: DEFAULT_OPENAI_MODEL },
  anthropic: { url: ANTHROPIC_BASE_URL, defaultModel: DEFAULT_ANTHROPIC_MODEL },
  google: { url: GOOGLE_BASE_URL, defaultModel: DEFAULT_GOOGLE_MODEL },
};

function isFixedEndpointKind(kind: CloudProviderKind): kind is FixedEndpointKind {
  return kind !== "custom";
}

/** A fixed-endpoint cloud slot (openai/anthropic/google): eligible with a key AND that slot's own consent. */
function fixedEndpointChainTarget(
  kind: FixedEndpointKind,
  admin: AdminParserSettings | null
): LlmTarget | null {
  const key =
    kind === "openai"
      ? admin?.llmOpenaiApiKey
      : kind === "anthropic"
        ? admin?.llmAnthropicApiKey
        : admin?.llmGoogleApiKey;
  const optIn =
    kind === "openai"
      ? admin?.llmOpenaiOptIn
      : kind === "anthropic"
        ? admin?.llmAnthropicOptIn
        : admin?.llmGoogleOptIn;
  if (!key || !(optIn ?? false)) return null;
  const configuredModel =
    kind === "openai"
      ? admin?.llmOpenaiModel
      : kind === "anthropic"
        ? admin?.llmAnthropicModel
        : admin?.llmGoogleModel;
  const { url, defaultModel } = FIXED_ENDPOINT[kind];
  return { kind, url, model: configuredModel || defaultModel, apiKey: key, isCloud: true };
}

/** The `custom` slot (beta.17's `openai_compatible`): a free-form base URL, eligible with a model AND consent (unless local). */
function customChainTarget(admin: AdminParserSettings | null): LlmTarget | null {
  const check = admin?.openaiCompatBaseUrl ? checkLlmBaseUrl(admin.openaiCompatBaseUrl) : null;
  if (!check?.ok || !admin?.openaiCompatModel) return null;
  const isCloud = !check.isLocal;
  if (isCloud && !(admin?.llmCustomOptIn ?? false)) return null;
  return {
    kind: "custom",
    url: check.url,
    model: admin.openaiCompatModel,
    ...(admin.openaiCompatApiKey ? { apiKey: admin.openaiCompatApiKey } : {}),
    isCloud,
  };
}

/** The admin's cloud-slot priority, comma-separated; an unknown/missing entry falls back to registration order, and every kind not named is appended once. */
export function parseProviderOrder(raw: string | null | undefined): CloudProviderKind[] {
  const named = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isCloudProviderKind);
  const order: CloudProviderKind[] = [];
  for (const kind of named) if (!order.includes(kind)) order.push(kind);
  for (const kind of CLOUD_PROVIDER_KINDS) if (!order.includes(kind)) order.push(kind);
  return order;
}

export function serializeProviderOrder(order: readonly CloudProviderKind[]): string {
  return order.join(",");
}

export const DEFAULT_PROVIDER_ORDER = CLOUD_PROVIDER_KINDS.join(",");

/**
 * The fallback chain, in the order it will be tried: Ollama first (when
 * eligible), then the enabled+consented cloud slots in the admin's priority.
 * An explicit `url`/`model` override (tests, legacy callers) bypasses the
 * chain entirely — a single Ollama target, as before.
 */
export async function resolveLlmChain(options: ResolveLlmTargetOptions = {}): Promise<LlmTarget[]> {
  const admin = await loadAdminSettings();

  if (options.url !== undefined || options.model !== undefined) {
    return [
      ollamaTarget(
        options.url ?? admin?.ollamaUrl ?? undefined,
        options.model ?? admin?.ollamaModel ?? undefined
      ),
    ];
  }

  const chain: LlmTarget[] = [];
  const ollama = ollamaChainTarget(admin);
  if (ollama) chain.push(ollama);

  for (const kind of parseProviderOrder(admin?.llmProviderOrder)) {
    const target = isFixedEndpointKind(kind)
      ? fixedEndpointChainTarget(kind, admin)
      : customChainTarget(admin);
    if (target) chain.push(target);
  }

  // Last resort: NOTHING is configured anywhere in the chain, and the caller
  // asked for the beta.17 behaviour "no admin config at all → assume a
  // localhost Ollama" (`getParserConfig`, the domain parsers). This never
  // fires when a cloud slot IS configured and consented — that stays ahead of
  // a phantom localhost entry nobody asked for.
  if (chain.length === 0 && options.withDefaults) {
    chain.push(ollamaTarget());
  }

  return chain;
}

/**
 * The target that WOULD be tried first — capability display
 * (`/parser-capabilities`), a pre-flight probe, or a caller that only ever
 * uses a single target. Null when the chain is empty (nothing configured or
 * consented anywhere). Callers that want the cascade use `llmGenerateChain`
 * instead.
 */
export async function resolveLlmTarget(
  options: ResolveLlmTargetOptions = {}
): Promise<LlmTarget | null> {
  const chain = await resolveLlmChain(options);
  return chain[0] ?? null;
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
  switch (kindOf(target)) {
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "custom":
      return "OpenAI-compatible provider";
  }
}

/**
 * The short form used INSIDE a request's own label (`"<this> request"`,
 * `"<this> availability check"`) — no "provider" suffix, so the beta.17
 * wording ("OpenAI-compatible request", "OpenAI-compatible availability
 * check") stays byte-identical for the `custom` slot after the rename from
 * `openai_compatible`. `llmProviderLabel` above is for a sentence that reads
 * "OpenAI-compatible provider not reachable: …" — a different grammatical
 * slot with a different exact string.
 */
function protocolLabel(target: LlmTarget): string {
  switch (kindOf(target)) {
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "custom":
      return "OpenAI-compatible";
  }
}

function bearerAuthHeaders(target: LlmTarget): Record<string, string> {
  return target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {};
}

function anthropicHeaders(target: LlmTarget): Record<string, string> {
  return { "x-api-key": target.apiKey ?? "", "anthropic-version": ANTHROPIC_VERSION };
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
   * Ask for a JSON object (Ollama `format: "json"`, OpenAI-shaped
   * `response_format: json_object`). Only for callers whose answer IS an
   * object: the flight parser expects a top-level array and leaves it off.
   * Anthropic has no equivalent protocol switch — its prompts already ask
   * for JSON text directly, so this flag is a no-op for that protocol.
   */
  json: boolean;
  timeoutMs: number;
  /** Error-message label for Ollama; defaults to "Ollama request". */
  label?: string;
}

/**
 * The two gates, in front of each request this module can send: the admin
 * switch and THAT SLOT'S OWN cloud consent. A pipeline that forgot to ask
 * `llmRefusalFor` fails closed here instead of sending the document
 * (`llmGate.entryPoints.test.ts` holds that every model endpoint in the source
 * sits behind them).
 */
async function assertMayAsk(target: LlmTarget): Promise<void> {
  await assertLlmEnabled();
  await assertLlmCloudConsent({
    kind: kindOf(target),
    isCloud: target.isCloud ?? isCloudUrl(target.url),
  });
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

/**
 * The OpenAI-compatible `/chat/completions` shape — shared by THREE kinds
 * (`openai`, `google`, `custom`). Only `target.url`/`target.model`/
 * `target.apiKey` differ between them; the request/response handling is
 * written once here rather than duplicated per kind.
 */
async function generateWithOpenAiShape(
  target: LlmTarget,
  req: LlmGenerateRequest
): Promise<string> {
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
    headers: bearerAuthHeaders(target),
    timeoutMs: req.timeoutMs,
    maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
    label: `${protocolLabel(target)} request`,
  });
  const failure = `Invalid ${protocolLabel(target)} response structure`;
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
 * Anthropic's native Messages API. Deliberately NOT the OpenAI shape: the
 * system prompt is a TOP-LEVEL field, never a message — bundling it into
 * `messages` (the OpenAI/Ollama convention) is a silent protocol mismatch the
 * model just answers worse to, never an error. `llmProvider.anthropic.test.ts`
 * pins this against a mock that would still accept a malformed body, so only
 * the request-shape assertion — not a failure — catches a regression here.
 */
async function generateWithAnthropic(target: LlmTarget, req: LlmGenerateRequest): Promise<string> {
  await assertMayAsk(target);
  const body = JSON.stringify({
    model: target.model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    temperature: req.temperature,
  });
  const raw = await requestTextWithDeadline({
    url: `${target.url}/messages`,
    method: "POST",
    body,
    headers: anthropicHeaders(target),
    timeoutMs: req.timeoutMs,
    maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
    label: "Anthropic request",
  });
  const failure = "Invalid Anthropic response structure";
  const envelope = parseEnvelope(raw, failure);
  const content =
    typeof envelope === "object" && envelope !== null
      ? (envelope as Record<string, unknown>).content
      : undefined;
  if (!Array.isArray(content)) throw new Error(failure);
  const text = content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
    )
    .map((block) => block.text)
    .join("");
  if (!text) throw new Error(failure);
  return text;
}

/**
 * Ask the model. Returns its raw text answer (think blocks and code fences
 * are the caller's to strip — each reads a different shape out of it). Every
 * protocol passes `assertMayAsk` before anything is sent.
 */
export async function llmGenerate(target: LlmTarget, req: LlmGenerateRequest): Promise<string> {
  const kind = kindOf(target);
  if (kind === "ollama") return generateWithOllama(target, req);
  if (kind === "anthropic") return generateWithAnthropic(target, req);
  return generateWithOpenAiShape(target, req); // openai, google, custom
}

export interface LlmGenerateChainResult {
  text: string;
  /** Which chain member actually answered — read this, never `chain[0]`, for honest attribution. */
  target: LlmTarget;
}

/**
 * Try the fallback chain in order. Only a connectivity/protocol failure
 * (`llmGenerate` throwing — network error, timeout, non-2xx, an unparsable or
 * wrongly-shaped envelope) moves to the next slot; a slot that returns text
 * — however poor the extraction — counts as served, and the chain stops
 * there. Every attempt is logged: a failure at `warn` naming the kind and
 * reason (never the body), a fallback-served answer at `info`. A slot that
 * was never eligible for the chain is simply absent — nothing here claims it
 * was tried.
 */
export async function llmGenerateChain(
  req: LlmGenerateRequest,
  options: ResolveLlmTargetOptions = {}
): Promise<LlmGenerateChainResult> {
  const chain = await resolveLlmChain(options);
  if (chain.length === 0) {
    throw new Error("No AI provider is configured");
  }
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    try {
      const text = await llmGenerate(target, req);
      if (i > 0) {
        logger.info(
          { servedBy: kindOf(target), model: target.model, earlierSlotsSkippedOrFailed: i },
          "[LLM] fallback chain: a later slot answered"
        );
      }
      return { text, target };
    } catch (err) {
      lastErr = err;
      logger.warn(
        {
          kind: kindOf(target),
          model: target.model,
          err: err instanceof Error ? err.message : String(err),
          nextInChain: i + 1 < chain.length,
        },
        "[LLM] fallback chain: a provider failed"
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All configured AI providers failed");
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
 * Is the endpoint up? Ollama: `GET /api/tags`. Anthropic: `GET /models` with
 * its own header pair. Everything else (openai/google/custom): `GET /models`
 * with a bearer key. None of the three carries a document, so a probe needs
 * no cloud consent — it is what "Verbindung testen" runs before the admin
 * opts in.
 */
export async function llmProbe(target: LlmTarget): Promise<LlmProbeResult> {
  const kind = kindOf(target);
  const ollama = kind === "ollama";
  const anthropic = kind === "anthropic";
  try {
    const raw = await requestTextWithDeadline({
      url: ollama ? `${target.url}/api/tags` : `${target.url}/models`,
      method: "GET",
      headers: anthropic ? anthropicHeaders(target) : bearerAuthHeaders(target),
      timeoutMs: LLM_AVAILABILITY_TIMEOUT_MS,
      maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
      label: `${protocolLabel(target)} availability check`,
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
