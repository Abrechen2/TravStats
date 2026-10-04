import http from "http";
import type { AddressInfo } from "net";

import * as parserSettings from "../../parserSettings";
import { clearReachableTargetCache, resolveReachableLlmTarget } from "../reachableTarget";

/**
 * The tester's instance of 2026-10-03: an Ollama endpoint that no longer
 * answers, ahead of a second provider that does. `chain[0]` sent every
 * document to the dead one; the second never saw a request.
 */

/** A port nothing listens on. */
const DEAD_OLLAMA = "http://127.0.0.1:9";

interface Fake {
  baseUrl: string;
  probes: number;
  close: () => Promise<void>;
}

/** An OpenAI-compatible endpoint whose `/models` answers. */
function fakeProvider(): Promise<Fake> {
  return new Promise((resolve) => {
    const state = { probes: 0 };
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/models") state.probes += 1;
      res.end(JSON.stringify({ data: [{ id: "cloud-model" }] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        get probes() {
          return state.probes;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function settings(
  value: Partial<Awaited<ReturnType<typeof parserSettings.getAdminParserSettings>>>
) {
  jest
    .spyOn(parserSettings, "getAdminParserSettings")
    .mockResolvedValue({ llmEnabled: true, ...value } as never);
}

describe("resolveReachableLlmTarget", () => {
  let provider: Fake;

  beforeEach(async () => {
    clearReachableTargetCache();
    provider = await fakeProvider();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await provider.close();
  });

  const deadOllamaThenProvider = () =>
    settings({
      ollamaUrl: DEAD_OLLAMA,
      ollamaModel: "gemma3:12b",
      openaiCompatBaseUrl: provider.baseUrl,
      openaiCompatModel: "cloud-model",
    });

  it("walks past a dead first slot to the provider that answers", async () => {
    deadOllamaThenProvider();
    const target = await resolveReachableLlmTarget({ withDefaults: true, wait: true });
    expect(target?.kind).toBe("custom");
    expect(target?.model).toBe("cloud-model");
  });

  it("without waiting, uses the first slot once and the answering one after the probes landed", async () => {
    deadOllamaThenProvider();
    const cold = await resolveReachableLlmTarget({ withDefaults: true, wait: false });
    expect(cold?.kind).toBe("ollama");
    await resolveReachableLlmTarget({ withDefaults: true, wait: true });
    const warm = await resolveReachableLlmTarget({ withDefaults: true, wait: false });
    expect(warm?.kind).toBe("custom");
  });

  it("asks a known answer from the cache instead of probing again", async () => {
    deadOllamaThenProvider();
    await resolveReachableLlmTarget({ withDefaults: true, wait: true });
    const before = provider.probes;
    await resolveReachableLlmTarget({ withDefaults: true, wait: true });
    expect(provider.probes).toBe(before);
  });

  it("returns the first slot when none answers, so callers still name it as unreachable", async () => {
    settings({
      ollamaUrl: DEAD_OLLAMA,
      ollamaModel: "gemma3:12b",
      openaiCompatBaseUrl: "http://127.0.0.1:9/v1",
      openaiCompatModel: "cloud-model",
    });
    const target = await resolveReachableLlmTarget({ withDefaults: true, wait: true });
    expect(target?.kind).toBe("ollama");
    expect(target?.url).toBe(DEAD_OLLAMA);
  });

  it("does not probe a lone slot — there is nothing to choose between", async () => {
    settings({ openaiCompatBaseUrl: provider.baseUrl, openaiCompatModel: "cloud-model" });
    const target = await resolveReachableLlmTarget({ wait: true });
    expect(target?.kind).toBe("custom");
    expect(provider.probes).toBe(0);
  });
});
