import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTranslation } from "../../hooks/useTranslation";

// react-i18next's useTranslation returns a NEW translation object on every
// render. The project wrapper must not leak that instability: components put
// `t` into hook dependency arrays, and an identity that changes per render
// re-fires those effects on every keystroke (issue #190 — the admin
// instance-settings form reset itself on each typed character).
const changeLanguage = vi.fn().mockResolvedValue(undefined);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `translated:${key}`,
    i18n: { language: "de", isInitialized: true, changeLanguage },
    ready: true,
  }),
}));

// Local store mock with a switchable language (the global setup.ts mock pins
// it and has no setState). Mutating `mockStore.language` + rerender() models
// the store-driven language switch.
const mockStore = vi.hoisted(() => ({ language: "de" }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { display: { language: mockStore.language } };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

describe("useTranslation — referential stability of t", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.language = "de";
  });

  it("returns the same t reference across unrelated re-renders", () => {
    const { result, rerender } = renderHook(() => useTranslation("common"));
    const firstT = result.current.t;

    rerender();
    rerender();

    expect(result.current.t).toBe(firstT);
  });

  it("t keeps delegating to the live translator (no stale closure)", () => {
    const { result, rerender } = renderHook(() => useTranslation("common"));
    const tBefore = result.current.t;
    rerender();

    // Even the reference captured before the re-render translates correctly.
    expect(tBefore("some.key")).toBe("translated:some.key");
    expect(result.current.t("some.key")).toBe("translated:some.key");
  });

  it("re-identifies t when the user switches the language", () => {
    const { result, rerender } = renderHook(() => useTranslation("common"));
    const before = result.current.t;

    mockStore.language = "en";
    rerender();

    // A language switch is the one moment consumers' `useMemo`s that list
    // `t` as a dependency MUST recompute — so the identity has to change.
    expect(result.current.t).not.toBe(before);
  });
});
