import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const lang = vi.hoisted(() => ({ current: "en" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "settings:about.madeBy" ? "A project by" : key),
    i18n: {
      get language() {
        return lang.current;
      },
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      isInitialized: true,
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { Abrechen2Credit, abrechen2SiteUrl } from "../Abrechen2Credit";

describe("Abrechen2Credit", () => {
  beforeEach(() => {
    lang.current = "en";
  });

  it("links to the English site for an English reader", () => {
    render(<Abrechen2Credit />);
    const link = screen.getByRole("link", { name: "A project by abrechen2" });
    expect(link).toHaveAttribute("href", "https://www.abrechen2.de/en/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links to the German site for a German reader", () => {
    lang.current = "de";
    render(<Abrechen2Credit />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.abrechen2.de/");
  });

  it("names the wordmark for assistive technology instead of typesetting it", () => {
    render(<Abrechen2Credit />);
    expect(screen.getByRole("img", { name: "abrechen2" }).tagName.toLowerCase()).toBe("svg");
  });

  it("treats regional German tags as German", () => {
    expect(abrechen2SiteUrl("de-DE")).toBe("https://www.abrechen2.de/");
    expect(abrechen2SiteUrl(undefined)).toBe("https://www.abrechen2.de/en/");
  });
});
