import { clearAvailabilityCache } from "../config";
import { clearLlmAvailabilityCache, isLlmAvailable, settleLlmProbes } from "../llmAvailability";
import logger from "../../../utils/logger";

/**
 * A probe that REJECTS (a bug in the probe, not an unreachable host) used to
 * be turned into "not reachable" by a bare `.catch(() => …)` — no log line, so
 * a broken probe read as a down model for ever (forgejo#385 RULE-39). The
 * answer stays "not reachable", and the failure now reaches the log as itself.
 */
jest.mock("../../parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({
    ollamaUrl: "http://127.0.0.1:9",
    ollamaModel: "mock",
  })),
  getParserOrder: jest.fn(async () => "template_first"),
}));
jest.mock("../../llm/llmProvider", () => ({
  ...jest.requireActual("../../llm/llmProvider"),
  llmProbe: jest.fn(async () => {
    throw new TypeError("probe exploded");
  }),
}));

describe("llmAvailability — a rejecting probe is logged, not swallowed", () => {
  beforeEach(() => {
    clearAvailabilityCache();
    clearLlmAvailabilityCache();
  });

  it("answers 'not reachable' and logs llm_probe_failed", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    await isLlmAvailable();
    await settleLlmProbes();
    await expect(isLlmAvailable()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "llm_probe_failed", errorName: "TypeError" })
    );
    warn.mockRestore();
  });
});
