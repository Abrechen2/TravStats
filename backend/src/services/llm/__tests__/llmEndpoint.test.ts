import { checkLlmBaseUrl, isLocalLlmHost } from "../llmEndpoint";
import * as parserSettings from "../../parserSettings";
import { llmRefusalFor } from "../llmGate";

jest.mock("../../../utils/sharedDemo", () => ({ isSharedDemoUser: jest.fn(async () => false) }));

/**
 * One rule decides both "may this endpoint be plain http" and "does a
 * document sent there leave the local network". These cases are the rule.
 */
describe("isLocalLlmHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.1",
    "192.168.178.155",
    "169.254.1.1",
    "[::1]",
    "[fd12:3456::1]",
    "ollama",
    "nas.local",
    "box.lan",
    "gpu.home.arpa",
    "host.docker.internal",
  ])("%s is on the local network", (host) => {
    expect(isLocalLlmHost(host)).toBe(true);
  });

  it.each([
    "api.openai.com",
    "openrouter.ai",
    "ollama.com",
    "8.8.8.8",
    "172.32.0.1",
    "[2001:db8::1]",
  ])("%s is outside it", (host) => {
    expect(isLocalLlmHost(host)).toBe(false);
  });
});

describe("checkLlmBaseUrl", () => {
  it("accepts https anywhere and strips the trailing slash", () => {
    expect(checkLlmBaseUrl("https://api.openai.com/v1/")).toEqual({
      ok: true,
      url: "https://api.openai.com/v1",
      isLocal: false,
    });
  });

  it("accepts plain http on the LAN — where Ollama has always lived", () => {
    expect(checkLlmBaseUrl("http://192.168.178.155:8000/v1")).toEqual({
      ok: true,
      url: "http://192.168.178.155:8000/v1",
      isLocal: true,
    });
  });

  it.each([
    ["http://api.openai.com/v1", "https_required"],
    ["ftp://nas.local/v1", "unsupported_protocol"],
    ["https://user:secret@api.openai.com/v1", "credentials_in_url"],
    ["not a url", "invalid_url"],
  ])("refuses %s as %s", (raw, problem) => {
    expect(checkLlmBaseUrl(raw)).toEqual({ ok: false, problem });
  });
});

describe("llmRefusalFor — the provider half", () => {
  const settings = (value: Partial<parserSettings.AdminParserSettings>) =>
    jest
      .spyOn(parserSettings, "getAdminParserSettings")
      .mockResolvedValue({ llmEnabled: true, ...value });
  const savedEnv = process.env.OLLAMA_URL;
  beforeEach(() => delete process.env.OLLAMA_URL);
  afterEach(() => {
    jest.restoreAllMocks();
    if (savedEnv === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = savedEnv;
  });

  it("refuses a cloud endpoint without the opt-in", async () => {
    settings({
      llmProvider: "openai_compatible",
      openaiCompatBaseUrl: "https://api.openai.com/v1",
      openaiCompatModel: "gpt-4o-mini",
      llmCloudOptIn: false,
    });
    await expect(llmRefusalFor()).resolves.toMatchObject({ kind: "cloud_not_consented" });
  });

  it("allows it with the opt-in", async () => {
    settings({
      llmProvider: "openai_compatible",
      openaiCompatBaseUrl: "https://api.openai.com/v1",
      openaiCompatModel: "gpt-4o-mini",
      llmCloudOptIn: true,
    });
    await expect(llmRefusalFor()).resolves.toBeNull();
  });

  it("needs no opt-in for a LAN endpoint", async () => {
    settings({
      llmProvider: "openai_compatible",
      openaiCompatBaseUrl: "http://192.168.178.155:8000/v1",
      openaiCompatModel: "qwen",
    });
    await expect(llmRefusalFor()).resolves.toBeNull();
  });

  it("names an incomplete setup instead of quietly using nothing", async () => {
    settings({
      llmProvider: "openai_compatible",
      openaiCompatBaseUrl: "https://api.openai.com/v1",
    });
    await expect(llmRefusalFor()).resolves.toMatchObject({ kind: "provider_incomplete" });
  });

  it("holds an Ollama at a public host to the same consent", async () => {
    settings({ ollamaUrl: "https://ollama.example.org", ollamaModel: "gemma3:12b" });
    await expect(llmRefusalFor()).resolves.toMatchObject({ kind: "cloud_not_consented" });
  });

  it("leaves the LAN Ollama every instance already has alone", async () => {
    settings({ ollamaUrl: "http://192.168.178.155:11434", ollamaModel: "gemma3:12b" });
    await expect(llmRefusalFor()).resolves.toBeNull();
  });

  it("the admin switch still wins over everything", async () => {
    settings({
      llmEnabled: false,
      llmProvider: "openai_compatible",
      openaiCompatBaseUrl: "https://api.openai.com/v1",
      openaiCompatModel: "gpt-4o-mini",
      llmCloudOptIn: true,
    });
    await expect(llmRefusalFor()).resolves.toMatchObject({ kind: "disabled_by_admin" });
  });
});
