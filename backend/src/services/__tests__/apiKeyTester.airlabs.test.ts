/**
 * Silent-failure review 2026-09-26: the AirLabs tester counted any HTTP 200
 * as "valid" unless it recognised the error field, and AirLabs reports a
 * refused key or a spent quota as exactly that — a 200 with an `error` body.
 * A network failure came back as "getaddrinfo ENOTFOUND airlabs.co", the only
 * text the settings card had to show.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../apiKeyResolver", () => ({
  getApiKey: jest.fn(async () => null as string | null),
}));

import { testAirlabsKey, testAerodataboxKey } from "../apiKeyTester";

beforeEach(() => {
  jest.resetAllMocks();
  mockedAxios.isAxiosError.mockImplementation(
    (error: unknown): boolean =>
      typeof error === "object" &&
      error !== null &&
      (error as { isAxiosError?: unknown }).isAxiosError === true
  );
});

describe("testAirlabsKey", () => {
  it("reads a 200 carrying an unknown-key error as an invalid key", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: { error: { message: "Unknown api_key", code: "unknown_api_key" } },
    });
    const result = await testAirlabsKey("bad");
    expect(result.success).toBe(false);
    expect(result.messageKey).toBe("invalid");
  });

  it("reads a 200 carrying a spent quota as rate-limited", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: { error: { message: "Month limit exceeded", code: "month_limit_exceeded" } },
    });
    const result = await testAirlabsKey("spent");
    expect(result).toMatchObject({ success: false, messageKey: "rateLimited" });
  });

  it("does not call an unrecognised 200 body valid", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { terms: "…" } });
    const result = await testAirlabsKey("odd");
    expect(result).toMatchObject({ success: false, messageKey: "protocol" });
  });

  it("still calls a real pong valid", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { response: "pong" } });
    expect((await testAirlabsKey("good")).success).toBe(true);
  });
});

describe("an unreachable provider has its own key", () => {
  it("names DNS failure 'unreachable', keeping the raw text as detail only", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      message: "getaddrinfo ENOTFOUND aerodatabox.p.rapidapi.com",
    });
    const result = await testAerodataboxKey("k");
    expect(result).toMatchObject({ success: false, messageKey: "unreachable" });
  });
});
