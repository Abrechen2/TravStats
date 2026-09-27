import http from "http";
import type { AddressInfo } from "net";

import * as parserSettings from "../../parserSettings";
import { llmGenerateChain, resolveLlmChain, type LlmProviderKind } from "../llmProvider";

/**
 * The fallback CHAIN (owner, 2026-09-26 — "vllt Fallback zulassen also lokal
 * bevorzugen sonst die Anbieter"): Ollama first when configured, THEN the
 * enabled+consented cloud slots in the admin's priority — cascading only on
 * a connectivity/protocol failure, never past a slot that answered. This is
 * the standing rule "a provider failure must never look like a silent
 * success" applied to a MULTI-slot pipeline: swallowing Ollama's failure and
 * quietly trying the next slot is fine ONLY because every attempt is logged
 * and the caller is told exactly which slot actually served
 * (`llmGenerateChain`'s returned `target`) — never a blended or anonymous
 * "cloud" answer.
 */

function settings(value: Partial<parserSettings.AdminParserSettings>) {
  return jest
    .spyOn(parserSettings, "getAdminParserSettings")
    .mockResolvedValue({ llmEnabled: true, ...value });
}

afterEach(() => jest.restoreAllMocks());

interface Recorder {
  server: http.Server;
  base: string;
  seen: string[];
  answer: { status: number; body: unknown };
}

async function startRecorder(): Promise<Recorder> {
  const rec: Recorder = {
    server: undefined as unknown as http.Server,
    base: "",
    seen: [],
    answer: { status: 200, body: { data: [] } },
  };
  rec.server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      rec.seen.push(req.url ?? "");
      res.statusCode = rec.answer.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(rec.answer.body));
    });
  });
  await new Promise<void>((resolve) => rec.server.listen(0, "127.0.0.1", resolve));
  rec.base = `http://127.0.0.1:${(rec.server.address() as AddressInfo).port}`;
  return rec;
}

const req = {
  system: "sys",
  prompt: "prompt",
  temperature: 0,
  json: true,
  timeoutMs: 3_000,
};

describe("resolveLlmChain: order, eligibility and skip-without-attempt", () => {
  it("Ollama first, then the cloud slots in the admin's priority order", async () => {
    settings({
      ollamaUrl: "http://192.168.178.155:11434",
      ollamaModel: "gemma3:12b",
      llmProviderOrder: "anthropic,openai,google,custom",
      llmAnthropicApiKey: "k1",
      llmAnthropicOptIn: true,
      llmOpenaiApiKey: "k2",
      llmOpenaiOptIn: true,
    });
    const chain = await resolveLlmChain();
    expect(chain.map((t) => t.kind)).toEqual(["ollama", "anthropic", "openai"]);
  });

  it("an unconsented slot is absent from the chain — not merely skipped, never IN it", async () => {
    settings({
      llmProviderOrder: "openai,anthropic",
      llmOpenaiApiKey: "k1",
      llmOpenaiOptIn: false, // configured but NOT consented
      llmAnthropicApiKey: "k2",
      llmAnthropicOptIn: true,
    });
    const chain = await resolveLlmChain();
    expect(chain.map((t) => t.kind)).toEqual(["anthropic"]);
  });

  it("reordering the admin's priority changes which slot is first", async () => {
    settings({
      llmProviderOrder: "google,openai",
      llmOpenaiApiKey: "k1",
      llmOpenaiOptIn: true,
      llmGoogleApiKey: "k2",
      llmGoogleOptIn: true,
    });
    const orderedGoogleFirst = await resolveLlmChain();
    expect(orderedGoogleFirst[0]?.kind).toBe("google");

    settings({
      llmProviderOrder: "openai,google",
      llmOpenaiApiKey: "k1",
      llmOpenaiOptIn: true,
      llmGoogleApiKey: "k2",
      llmGoogleOptIn: true,
    });
    const orderedOpenaiFirst = await resolveLlmChain();
    expect(orderedOpenaiFirst[0]?.kind).toBe("openai");
  });
});

describe("llmGenerateChain: cascades on connectivity failure, stops on any answer", () => {
  let cloudA: Recorder;
  let cloudB: Recorder;

  beforeAll(async () => {
    cloudA = await startRecorder();
    cloudB = await startRecorder();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => cloudA.server.close(() => resolve()));
    await new Promise<void>((resolve) => cloudB.server.close(() => resolve()));
  });

  beforeEach(() => {
    cloudA.seen.length = 0;
    cloudB.seen.length = 0;
    cloudA.answer = { status: 200, body: { choices: [{ message: { content: "A answered" } }] } };
    cloudB.answer = { status: 200, body: { choices: [{ message: { content: "B answered" } }] } };
  });

  /** A loopback address nothing listens on — ECONNREFUSED, fast, no real network. */
  const UNREACHABLE_OLLAMA = "http://127.0.0.1:1";

  it("Ollama unreachable falls through to the first eligible cloud slot, and names it honestly", async () => {
    settings({
      ollamaUrl: UNREACHABLE_OLLAMA,
      ollamaModel: "gemma3:12b",
      llmProviderOrder: "openai,anthropic,google,custom",
      openaiCompatBaseUrl: cloudA.base,
      openaiCompatModel: "test-model",
      llmCustomOptIn: true,
    });
    const result = await llmGenerateChain(req);
    expect(result.text).toBe("A answered");
    // The caller is told EXACTLY which slot served it — never "ollama" and
    // never an anonymous "cloud".
    expect(result.target.kind).toBe("custom");
    expect(cloudA.seen).toEqual(["/chat/completions"]);
  });

  it("a slot that answers stops the chain — the next eligible slot is never even called", async () => {
    // Ollama and `custom` are the two slots whose URL an admin can point
    // anywhere — the only pair this test can independently mock. Ollama
    // answers first; `custom` (cloudB) must never see a request.
    cloudA.answer = { status: 200, body: { response: "A answered" } }; // Ollama's own envelope.
    settings({
      ollamaUrl: cloudA.base,
      ollamaModel: "test-model",
      llmProviderOrder: "custom",
      openaiCompatBaseUrl: cloudB.base,
      openaiCompatModel: "test-model",
      llmCustomOptIn: true,
    });
    const result = await llmGenerateChain(req);
    expect(result.text).toBe("A answered");
    expect(result.target.kind).toBe("ollama");
    expect(cloudA.seen).toEqual(["/api/generate"]);
    expect(cloudB.seen).toEqual([]);
  });

  it("a slot that answers POORLY (empty extraction) still stops the chain — never a silent substitution", async () => {
    // Ollama answers with an empty-but-valid string; that is still an
    // ANSWER, not a connectivity failure, so `custom` must stay untouched.
    cloudA.answer = { status: 200, body: { response: "" } };
    settings({
      ollamaUrl: cloudA.base,
      ollamaModel: "test-model",
      llmProviderOrder: "custom",
      openaiCompatBaseUrl: cloudB.base,
      openaiCompatModel: "test-model",
      llmCustomOptIn: true,
    });
    const result = await llmGenerateChain(req);
    expect(result.text).toBe("");
    expect(result.target.kind).toBe("ollama");
    expect(cloudB.seen).toEqual([]);
  });

  it("every attempt is logged — a failure at warn naming the kind, a fallback answer at info", async () => {
    const logger = (await import("../../../utils/logger")).default;
    const warnSpy = jest.spyOn(logger, "warn");
    const infoSpy = jest.spyOn(logger, "info");
    settings({
      ollamaUrl: UNREACHABLE_OLLAMA,
      ollamaModel: "gemma3:12b",
      llmProviderOrder: "custom",
      openaiCompatBaseUrl: cloudA.base,
      openaiCompatModel: "test-model",
      llmCustomOptIn: true,
    });
    await llmGenerateChain(req);

    const warnedAboutOllama = warnSpy.mock.calls.some(
      ([context]) =>
        typeof context === "object" &&
        context !== null &&
        (context as { kind?: LlmProviderKind }).kind === "ollama"
    );
    expect(warnedAboutOllama).toBe(true);

    const infoedAboutFallback = infoSpy.mock.calls.some(
      ([context, message]) =>
        typeof message === "string" &&
        message.includes("a later slot answered") &&
        typeof context === "object" &&
        context !== null &&
        (context as { servedBy?: LlmProviderKind }).servedBy === "custom"
    );
    expect(infoedAboutFallback).toBe(true);
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("when the whole chain fails, the caller gets the LAST failure — never a silent empty success", async () => {
    settings({
      ollamaUrl: UNREACHABLE_OLLAMA,
      ollamaModel: "gemma3:12b",
    });
    await expect(llmGenerateChain(req)).rejects.toThrow();
  });

  it("an empty chain (nothing configured, no defaults asked) throws rather than silently answering nothing", async () => {
    settings({});
    await expect(llmGenerateChain(req)).rejects.toThrow("No AI provider is configured");
  });
});
