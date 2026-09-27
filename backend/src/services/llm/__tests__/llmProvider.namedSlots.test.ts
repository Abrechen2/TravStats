import http from "http";
import type { AddressInfo } from "net";

import * as parserSettings from "../../parserSettings";
import {
  llmGenerate,
  llmProbe,
  resolveLlmChain,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
  GOOGLE_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GOOGLE_MODEL,
  type LlmTarget,
} from "../llmProvider";

/**
 * The four named cloud slots (beta.18), unit-level:
 *
 *  - `resolveLlmChain` builds the right TARGET for each fixed-endpoint slot
 *    (openai/anthropic/google) from admin settings — fixed URL, configured or
 *    default model, decrypted key — without a network call.
 *  - `llmGenerate` builds the right REQUEST for each protocol, against a real
 *    loopback HTTP server that records every request at the socket. The
 *    fixed URL is swapped for the loopback one on the hand-built target —
 *    this is what actually exercises `generateWithAnthropic` /
 *    `generateWithOpenAiShape`'s request-building, never the real internet.
 *  - Per-slot consent: `llmGenerate` on an unconsented kind never reaches the
 *    socket; a granted OpenAI consent does not enable Anthropic.
 *
 * `getAdminParserSettings` is mocked throughout — no database, no network.
 */

function settings(value: Partial<parserSettings.AdminParserSettings>) {
  return jest
    .spyOn(parserSettings, "getAdminParserSettings")
    .mockResolvedValue({ llmEnabled: true, ...value });
}

afterEach(() => jest.restoreAllMocks());

describe("resolveLlmChain builds each fixed-endpoint slot correctly", () => {
  it("openai: fixed URL, configured model, decrypted key, always cloud", async () => {
    settings({
      llmProviderOrder: "openai,anthropic,google,custom",
      llmOpenaiApiKey: "sk-openai-test",
      llmOpenaiModel: "gpt-4o",
      llmOpenaiOptIn: true,
    });
    const chain = await resolveLlmChain();
    expect(chain).toEqual([
      {
        kind: "openai",
        url: OPENAI_BASE_URL,
        model: "gpt-4o",
        apiKey: "sk-openai-test",
        isCloud: true,
      },
    ]);
  });

  it("openai: an empty model field falls back to the documented default", async () => {
    settings({ llmOpenaiApiKey: "sk-openai-test", llmOpenaiOptIn: true });
    const chain = await resolveLlmChain();
    expect(chain[0]?.model).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("anthropic: fixed native-API URL, configured model, decrypted key", async () => {
    settings({
      llmAnthropicApiKey: "sk-ant-test",
      llmAnthropicModel: "claude-opus-4",
      llmAnthropicOptIn: true,
    });
    const chain = await resolveLlmChain();
    expect(chain).toEqual([
      {
        kind: "anthropic",
        url: ANTHROPIC_BASE_URL,
        model: "claude-opus-4",
        apiKey: "sk-ant-test",
        isCloud: true,
      },
    ]);
  });

  it("anthropic: defaults to the documented alias model when none is set", async () => {
    settings({ llmAnthropicApiKey: "sk-ant-test", llmAnthropicOptIn: true });
    const chain = await resolveLlmChain();
    expect(chain[0]?.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it("google: fixed OpenAI-compatible URL, configured model, decrypted key", async () => {
    settings({
      llmGoogleApiKey: "AIza-test",
      llmGoogleModel: "gemini-1.5-pro",
      llmGoogleOptIn: true,
    });
    const chain = await resolveLlmChain();
    expect(chain).toEqual([
      {
        kind: "google",
        url: GOOGLE_BASE_URL,
        model: "gemini-1.5-pro",
        apiKey: "AIza-test",
        isCloud: true,
      },
    ]);
  });

  it("google: defaults to the documented model when none is set", async () => {
    settings({ llmGoogleApiKey: "AIza-test", llmGoogleOptIn: true });
    const chain = await resolveLlmChain();
    expect(chain[0]?.model).toBe(DEFAULT_GOOGLE_MODEL);
  });

  it("a configured slot without consent never enters the chain at all", async () => {
    settings({ llmOpenaiApiKey: "sk-openai-test", llmOpenaiOptIn: false });
    await expect(resolveLlmChain()).resolves.toEqual([]);
  });

  it("a key-less slot never enters the chain even with consent", async () => {
    settings({ llmOpenaiOptIn: true });
    await expect(resolveLlmChain()).resolves.toEqual([]);
  });
});

describe("each protocol's real request shape, against a recording loopback server", () => {
  let server: http.Server;
  let base: string;
  interface Seen {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }
  const seen: Seen[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        res.statusCode = answer.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
    // llmGenerate always runs assertMayAsk first — a cloud target needs its
    // slot's own consent, granted here for every kind under test.
    settings({
      llmOllamaOptIn: true,
      llmOpenaiOptIn: true,
      llmAnthropicOptIn: true,
      llmGoogleOptIn: true,
      llmCustomOptIn: true,
    });
  });

  const req = {
    system: "You extract structured JSON from a booking mail.",
    prompt: "Subject: Hotel Seeblick\n\nAnreise 04.06.2026, Abreise 06.06.2026.",
    temperature: 0,
    json: true,
    timeoutMs: 5_000,
  };

  it("anthropic: x-api-key + anthropic-version headers, system as a TOP-LEVEL field — never bundled into messages", async () => {
    answer = {
      status: 200,
      body: { content: [{ type: "text", text: '{"ok":true}' }] },
    };
    const target: LlmTarget = {
      kind: "anthropic",
      url: base,
      model: "claude-opus-4",
      apiKey: "sk-ant-test",
      isCloud: true,
    };
    const text = await llmGenerate(target, req);
    expect(text).toBe('{"ok":true}');

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call.url).toBe("/messages");
    expect(call.headers["x-api-key"]).toBe("sk-ant-test");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.headers["content-type"]).toBe("application/json");
    // No Authorization/Bearer header — Anthropic's own scheme, not OpenAI's.
    expect(call.headers.authorization).toBeUndefined();

    const body = JSON.parse(call.body) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.model).toBe("claude-opus-4");
    expect(typeof body.max_tokens).toBe("number");
    // THE assertion this file exists for: system is a SIBLING of `messages`,
    // not an entry inside it. A regression that bundled it the OpenAI way
    // would still have `body.system` undefined and a 2-element `messages`
    // array with a "system" role — this fails on EITHER symptom.
    expect(body.system).toBe(req.system);
    expect(body.messages).toEqual([{ role: "user", content: req.prompt }]);
    expect(body.messages.some((m) => m.role === "system")).toBe(false);
    expect(body.temperature).toBe(0);
  });

  it("anthropic: concatenates multiple text blocks and ignores non-text ones", async () => {
    answer = {
      status: 200,
      body: {
        content: [
          { type: "text", text: '{"a":1,' },
          { type: "tool_use", id: "x", name: "noop", input: {} },
          { type: "text", text: '"b":2}' },
        ],
      },
    };
    const target: LlmTarget = {
      kind: "anthropic",
      url: base,
      model: "claude-opus-4",
      apiKey: "k",
      isCloud: true,
    };
    const text = await llmGenerate(target, req);
    expect(text).toBe('{"a":1,"b":2}');
  });

  it("anthropic: maps a 401/429/5xx to the SAME failure-kind vocabulary the other protocols use — no second taxonomy", async () => {
    answer = { status: 429, body: { error: { type: "rate_limit_error" } } };
    const target: LlmTarget = {
      kind: "anthropic",
      url: base,
      model: "claude-opus-4",
      apiKey: "k",
      isCloud: true,
    };
    // Same shape every protocol already throws: "<label> returned HTTP <code>".
    await expect(llmGenerate(target, req)).rejects.toThrow("Anthropic request returned HTTP 429");
  });

  it.each([
    ["openai", DEFAULT_OPENAI_MODEL] as const,
    ["google", DEFAULT_GOOGLE_MODEL] as const,
    ["custom", "meta-llama/llama-3.1-70b"] as const,
  ])(
    "%s: reuses the OpenAI-compatible /chat/completions shape — Bearer key, system+user messages",
    async (kind, model) => {
      answer = {
        status: 200,
        body: { choices: [{ message: { role: "assistant", content: '{"ok":true}' } }] },
      };
      const target: LlmTarget = { kind, url: base, model, apiKey: "the-key", isCloud: true };
      const text = await llmGenerate(target, req);
      expect(text).toBe('{"ok":true}');

      expect(seen).toHaveLength(1);
      const [call] = seen;
      expect(call.url).toBe("/chat/completions");
      expect(call.headers.authorization).toBe("Bearer the-key");
      // Not Anthropic's headers.
      expect(call.headers["x-api-key"]).toBeUndefined();
      expect(call.headers["anthropic-version"]).toBeUndefined();

      const body = JSON.parse(call.body) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
        temperature: number;
      };
      expect(body.model).toBe(model);
      expect(body.messages).toEqual([
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ]);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.temperature).toBe(0);
    }
  );

  it("a slot without ITS OWN consent is never asked — no socket call at all, whatever else is consented", async () => {
    settings({
      llmOpenaiOptIn: true, // granted — but this is an Anthropic target
      llmAnthropicOptIn: false, // NOT granted
    });
    const target: LlmTarget = {
      kind: "anthropic",
      url: base,
      model: "claude-opus-4",
      apiKey: "k",
      isCloud: true,
    };
    await expect(llmGenerate(target, req)).rejects.toMatchObject({
      code: "LLM_CLOUD_NOT_CONSENTED",
    });
    expect(seen).toEqual([]);
  });

  it("probe (Verbindung testen) for anthropic uses the same header pair, GET /models, no document", async () => {
    answer = { status: 200, body: { data: [{ id: "claude-opus-4" }, { id: "claude-haiku-4" }] } };
    const target: LlmTarget = {
      kind: "anthropic",
      url: base,
      model: "claude-opus-4",
      apiKey: "k",
      isCloud: true,
    };
    const result = await llmProbe(target);
    expect(result).toEqual({ reachable: true, models: ["claude-opus-4", "claude-haiku-4"] });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/models");
    expect(seen[0].headers["x-api-key"]).toBe("k");
    expect(seen[0].method).toBe("GET");
  });
});
