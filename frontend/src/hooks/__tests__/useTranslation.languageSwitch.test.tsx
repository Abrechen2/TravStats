import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const lang = vi.hoisted(() => ({ spoken: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `${lang.spoken}:${key}`,
    i18n: { language: lang.spoken, isInitialized: false, changeLanguage: vi.fn() },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { useTranslation } from "../useTranslation";

function Label(): JSX.Element {
  const { t } = useTranslation("places");
  // Cached the way the import wizards cache their field labels.
  const label = useMemo(() => t("import.fields.lat"), [t]);
  return <span data-testid="label">{label}</span>;
}

/**
 * UAT rc.45: the places CSV wizard showed "Latitude" in the German UI. Its labels are a memo
 * over `t`, and `t` changed identity only with the STORED language, not when i18n itself
 * switched (detected English at start, German once the settings arrived).
 */
describe("useTranslation — a memo over t follows the language i18n speaks", () => {
  it("re-derives cached labels when i18n switches language", () => {
    const { rerender } = render(<Label />);
    expect(screen.getByTestId("label")).toHaveTextContent("en:import.fields.lat");
    lang.spoken = "de";
    rerender(<Label />);
    expect(screen.getByTestId("label")).toHaveTextContent("de:import.fields.lat");
  });
});
