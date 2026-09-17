import { expect, afterAll, afterEach, vi } from "vitest";
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
  // One date and clock format for the whole suite, so an assertion on a date
  // does not depend on the machine's locale (lib/displayFormat.ts).
  const defaultState = {
    display: { language: "en", dateFormat: "DD.MM.YYYY", timeFormat: "24h" },
    units: { currency: "EUR", distanceUnit: "kilometers" },
    baseCurrency: "EUR",
    defaults: {
      flightCategory: "business",
      seatClass: "economy",
    },
  };
  const useSettingsStore = Object.assign(
    vi.fn((selector?: (state: Record<string, unknown>) => unknown) => {
      if (typeof selector === "function") {
        return selector(defaultState);
      }
      return defaultState;
    }),
    { getState: () => defaultState }
  );
  return {
    ...actual,
    useSettingsStore,
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

/**
 * A unit test must not render outside `act(...)` either.
 *
 * The other half of forgejo#110, which asked for unexpected network AND
 * console errors to fail. An `act(...)` warning says a state update landed
 * after the assertions did — so what the test measured is an intermediate
 * render, not the settled one it claims to check. React reports that through
 * `console.error`, and a printed warning in a passing run is read by nobody.
 *
 * NARROWED TO act ON PURPOSE. Failing on every `console.error` turns 152 tests
 * across 51 files red (measured 2026-09-15), and most of those log deliberately
 * while exercising an error path. That is a different piece of work.
 *
 * Held as a ratchet, the way file size is: the 34 files that warn TODAY are
 * frozen in `consoleActBaseline.json`, and a file that is not on the list
 * fails. Adding to that list is not a way out — it only shrinks.
 *
 * It deliberately does NOT fail on a stale entry, which the other ratchets in
 * this repo do. An act warning is timing-dependent: a baselined file can
 * happen not to warn on one run, and failing it there would be flaky. A flaky
 * guard is worse than a weak one, because it teaches people to rerun until
 * green. A clean baselined file prints a note naming itself instead, and the
 * line is deleted by hand.
 *
 * Measured when this landed: every one of the 34 warned on the run that froze
 * them, so the list started exact rather than padded.
 */
import actBaseline from "./consoleActBaseline.json";

const baselinedFiles = new Set(actBaseline as string[]);

/** The path as the baseline spells it: repo-relative, forward slashes. */
function currentTestFile(): string {
  const raw = expect.getState().testPath ?? "";
  const normalized = raw.replace(/${BS}${BS}/g, "/");
  const marker = "/frontend/";
  const at = normalized.lastIndexOf(marker);
  return at === -1 ? normalized : normalized.slice(at + marker.length);
}

const actWarnings: string[] = [];
let sawActWarningInThisFile = false;

const realConsoleError = console.error.bind(console);
console.error = ((...args: unknown[]) => {
  const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  if (text.includes("not wrapped in act(")) {
    actWarnings.push(text);
    sawActWarningInThisFile = true;
  }
  realConsoleError(...args);
}) as typeof console.error;

afterAll(() => {
  const file = currentTestFile();
  if (baselinedFiles.has(file) && !sawActWarningInThisFile) {
    realConsoleError(
      `[act ratchet] ${file} no longer renders outside act(...). ` +
        "Delete that line from src/__tests__/consoleActBaseline.json — the list only shrinks."
    );
  }
});

// Cleanup after each test
afterEach(() => {
  cleanup();

  const seenActWarnings = [...new Set(actWarnings)];
  actWarnings.length = 0;

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

  if (seenActWarnings.length > 0 && !baselinedFiles.has(currentTestFile())) {
    throw new Error(
      [
        `This test rendered outside act(...) ${seenActWarnings.length === 1 ? "once" : `${seenActWarnings.length} times`}:`,
        ...seenActWarnings.map((e) => `  - ${e.slice(0, 240)}`),
        "",
        "A state update landed after the assertions did, so what was measured",
        "is an intermediate render rather than the settled one. Await the",
        "settled state (findBy*, waitFor) or wrap the interaction in act().",
        "",
        "Do NOT add the file to consoleActBaseline.json — that list only",
        "shrinks (forgejo#110).",
      ].join("\n")
    );
  }
});
