import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import LodgingEnrichButton from "../LodgingEnrichButton";
import { openDataApi } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";
import { useToastStore } from "../../../store/toastStore";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return { ...original, openDataApi: { ...original.openDataApi, enrichLodging: vi.fn() } };
});

/** Beta `lodgingEnrichment`: behind the beta switch AND the open data switch. */
describe("LodgingEnrichButton", () => {
  const addToast = vi.fn();
  beforeEach(() => {
    addToast.mockReset();
    useToastStore.setState({ addToast });
  });

  it("is not there without both switches", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: false });
    const { container } = render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    act(() => useSettingsStore.setState({ betaFeaturesEnabled: false, openDataEnabled: true }));
    const second = render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("says which fields it filled and reloads the page's lodging", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: true });
    vi.mocked(openDataApi.enrichLodging).mockResolvedValue({
      found: true,
      reason: null,
      osmRef: "osm:node/1",
      osmName: "Adlon Kempinski",
      filled: ["website", "chain"],
    });
    const onDone = vi.fn();
    render(<LodgingEnrichButton lodgingId="l1" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "openData:lodging.enrich" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(addToast.mock.calls[0][0]).toBe("success");
    expect(addToast.mock.calls[0][1]).toContain("openData:lodging.field.website");
  });

  it("tells the reader when OpenStreetMap does not know the house", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: true });
    vi.mocked(openDataApi.enrichLodging).mockResolvedValue({
      found: false,
      reason: "notFound",
      osmRef: null,
      osmName: null,
      filled: [],
    });
    const onDone = vi.fn();
    render(<LodgingEnrichButton lodgingId="l1" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "openData:lodging.enrich" }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("info", "openData:lodging.notFound"));
    expect(onDone).not.toHaveBeenCalled();
  });
});
