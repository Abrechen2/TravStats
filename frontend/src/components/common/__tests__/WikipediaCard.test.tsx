import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import WikipediaCard from "../WikipediaCard";
import { openDataApi } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return {
    ...original,
    openDataApi: { ...original.openDataApi, placeWikipedia: vi.fn(), lodgingWikipedia: vi.fn() },
  };
});

const SUMMARY = {
  title: "Brandenburger Tor",
  extract: "Das Brandenburger Tor ist ein Tor.",
  thumbnailUrl: null,
  pageUrl: "https://de.wikipedia.org/wiki/Brandenburger_Tor",
  lang: "de" as const,
};

describe("WikipediaCard", () => {
  beforeEach(() => vi.mocked(openDataApi.placeWikipedia).mockResolvedValue(SUMMARY));

  it("asks nobody while the instance's open data switch is off", () => {
    useSettingsStore.setState({ openDataEnabled: false });
    render(<WikipediaCard kind="place" id="p1" />);
    expect(openDataApi.placeWikipedia).not.toHaveBeenCalled();
    expect(screen.queryByText("Brandenburger Tor")).toBeNull();
  });

  it("shows the article's opening, a link to the rest and the licence", async () => {
    useSettingsStore.setState({ openDataEnabled: true });
    render(<WikipediaCard kind="place" id="p1" />);
    expect(await screen.findByText("Brandenburger Tor")).toBeInTheDocument();
    expect(openDataApi.placeWikipedia).toHaveBeenCalledWith("p1", "de");
    expect(screen.getByRole("link", { name: "openData:wikipedia.readMore" })).toHaveAttribute(
      "href",
      SUMMARY.pageUrl
    );
    expect(screen.getByText("openData:wikipedia.license")).toBeInTheDocument();
  });

  it("draws nothing for a thing without an article", async () => {
    useSettingsStore.setState({ openDataEnabled: true });
    vi.mocked(openDataApi.lodgingWikipedia).mockResolvedValue(null);
    const { container } = render(<WikipediaCard kind="lodging" id="l1" />);
    await vi.waitFor(() => expect(openDataApi.lodgingWikipedia).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
