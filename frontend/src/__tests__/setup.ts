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

// Cleanup after each test
afterEach(() => {
  cleanup();
});
