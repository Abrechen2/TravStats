/**
 * Unit tests for the logostream and Google Places testers added to
 * apiKeyTester.ts for the admin "Test" buttons (routes/admin/apiKeys.ts
 * POST /api-keys/test/logostream and /api-keys/test/googlePlaces).
 *
 * axios is mocked so no real network call is ever made. apiKeyResolver is
 * mocked too so the resolver fallback path never touches the DB — every
 * test here passes a key directly, so the fallback is never exercised, but
 * mocking the module keeps this a pure unit test like the neighbouring
 * flightLookup.aerodatabox.test.ts convention.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../apiKeyResolver", () => ({
  getApiKey: jest.fn(async () => null as string | null),
}));

import { testLogostreamKey, testGooglePlacesKey } from "../apiKeyTester";

beforeEach(() => {
  jest.resetAllMocks();
  // Real axios.isAxiosError checks `error.isAxiosError === true`. The
  // jest automock replaces it with a bare jest.fn() returning undefined,
  // so extractAxiosErrorInfo() would never recognise a mocked rejection as
  // an axios error. Reimplement the real check for the mock.
  mockedAxios.isAxiosError.mockImplementation(
    (error: unknown): boolean =>
      typeof error === "object" &&
      error !== null &&
      (error as { isAxiosError?: unknown }).isAxiosError === true,
  );
});

describe("testLogostreamKey", () => {
  it("returns success on a 200 image response", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: Buffer.from("png-bytes") });

    const result = await testLogostreamKey("real-key-1234567890");

    expect(result).toEqual({ success: true, message: "API key is valid" });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://airlines-api.logostream.dev/airlines/iata/AA?variant=icon&key=real-key-1234567890",
      expect.objectContaining({ responseType: "arraybuffer" }),
    );
  });

  it("reports an invalid key on 401", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });

    const result = await testLogostreamKey("bad-key");

    expect(result).toEqual({ success: false, message: "Invalid API key" });
  });

  it("reports an invalid key on 403", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 } });

    const result = await testLogostreamKey("bad-key");

    expect(result).toEqual({ success: false, message: "Invalid API key" });
  });

  it("surfaces the axios error message on a timeout/network failure", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      code: "ECONNABORTED",
      message: "timeout of 10000ms exceeded",
    });

    const result = await testLogostreamKey("some-key");

    expect(result).toEqual({ success: false, message: "timeout of 10000ms exceeded" });
  });
});

describe("testGooglePlacesKey", () => {
  it("returns success with the billing cost named in the message on a 200 response", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { places: [{ displayName: { text: "Frankfurt Airport" } }] },
    });

    const result = await testGooglePlacesKey("real-google-key-1234567890");

    expect(result.success).toBe(true);
    expect(result.message).toContain("0.03 USD");
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      { textQuery: "Frankfurt Airport" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Goog-Api-Key": "real-google-key-1234567890",
          "X-Goog-FieldMask": "places.displayName",
        }),
      }),
    );
  });

  it("surfaces Google's error message on 400 INVALID_ARGUMENT (malformed key)", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
          },
        },
      },
    });

    const result = await testGooglePlacesKey("bad-key");

    expect(result).toEqual({
      success: false,
      message: "API key not valid. Please pass a valid API key.",
    });
  });

  it("surfaces Google's error message on 403 PERMISSION_DENIED (disabled API)", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          error: {
            code: 403,
            message: "Places API (New) has not been used in project 123 before or it is disabled.",
            status: "PERMISSION_DENIED",
          },
        },
      },
    });

    const result = await testGooglePlacesKey("bad-key");

    expect(result.success).toBe(false);
    expect(result.message).toContain("disabled");
  });
});
