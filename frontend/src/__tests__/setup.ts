import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Global react-i18next mock - t function returns the key
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      isInitialized: true,
    },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

// Global settingsStore mock for useTranslation hook
vi.mock("../store/settingsStore", async () => {
  const actual = await vi.importActual("../store/settingsStore");
  return {
    ...actual,
    useSettingsStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) => {
      const defaultState = {
        display: { language: "en" },
        units: { currency: "EUR", distanceUnit: "kilometers" },
        baseCurrency: "EUR",
        defaults: {
          flightCategory: "business",
          seatClass: "economy",
        },
      };
      if (typeof selector === "function") {
        return selector(defaultState);
      }
      return defaultState;
    }),
  };
});

/**
 * A unit test must not reach the network.
 *
 * forgejo#110: four green test files, and stderr carried two jsdom
 * `AggregateError`s from XMLHttpRequest. The cause was that
 * `FlightCompleteStep.timesFieldsWiring.test.tsx` mocked `../../lib/api` while
 * `TripSelectField` imports `tripsApi` from `../../../lib/api/trips` — a
 * different module, so the mock never applied and `getAll()` fired a real
 * request. Its `.catch` logged a warning and the test stayed green, which means
 * the component was never actually exercised against a known answer: the
 * assertion passed on the EMPTY list a failed request leaves behind.
 *
 * A request that escapes is therefore not noise. It is a test asserting
 * something other than what it claims, so it fails here rather than printing.
 * The fix is always to mock the module the component really imports.
 */
const escapedRequests: string[] = [];

const realXhrOpen = globalThis.XMLHttpRequest?.prototype?.open;
if (realXhrOpen) {
  globalThis.XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    escapedRequests.push(`${method} ${String(url)}`);
    return (realXhrOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof realXhrOpen;
}

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  escapedRequests.push(`${init?.method ?? "GET"} ${url}`);
  return realFetch
    ? realFetch(input as RequestInfo, init)
    : Promise.reject(new Error("fetch is not available in this environment"));
}) as typeof globalThis.fetch;

// Cleanup after each test
afterEach(() => {
  cleanup();
  if (escapedRequests.length > 0) {
    const seen = [...new Set(escapedRequests)];
    escapedRequests.length = 0;
    throw new Error(
      [
        `This test reached the network ${seen.length === 1 ? "once" : `${seen.length} times`}:`,
        ...seen.map((r) => `  - ${r}`),
        "",
        "A unit test must not. Mock the module the component actually imports —",
        "mocking a barrel such as `lib/api` does NOT cover a component that",
        "imports `lib/api/trips` directly (forgejo#110).",
      ].join("\n")
    );
  }
});
