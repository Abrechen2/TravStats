import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import LodgingEnrichButton from "../LodgingEnrichButton";
import { openDataApi, type LodgingEnrichmentPreview } from "../../../lib/api/openData";
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
  return {
    ...original,
    openDataApi: {
      ...original.openDataApi,
      enrichLodging: vi.fn(),
      previewLodgingEnrichment: vi.fn(),
    },
  };
});

const MATCH = {
  osmRef: "osm:way/123",
  osmType: "way" as const,
  osmId: 123,
  name: "Adlon Kempinski",
  distanceM: 40,
  url: "https://www.openstreetmap.org/way/123",
};

const PREVIEW: LodgingEnrichmentPreview = {
  found: true,
  reason: null,
  match: MATCH,
  fields: [
    { field: "stars", current: 4, proposed: 5, apply: false },
    { field: "website", current: null, proposed: "https://adlon.example", apply: true },
  ],
  storesReference: true,
};

const NOTHING = { found: false, match: null, fields: [], storesReference: false };

function clickEnrich(): void {
  fireEvent.click(screen.getByRole("button", { name: "openData:lodging.enrich" }));
}

/** Beta `lodgingEnrichment`: behind the beta switch AND the open data switch. */
describe("LodgingEnrichButton", () => {
  const addToast = vi.fn();
  beforeEach(() => {
    addToast.mockReset();
    vi.mocked(openDataApi.enrichLodging).mockReset();
    vi.mocked(openDataApi.previewLodgingEnrichment).mockReset();
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
});

// 2026-10-22: the matched house was never shown, so a wrong match could not be
// spotted before its values landed in the record.
describe("LodgingEnrichButton — the preview before anything is written", () => {
  const addToast = vi.fn();
  beforeEach(() => {
    addToast.mockReset();
    vi.mocked(openDataApi.enrichLodging).mockReset();
    vi.mocked(openDataApi.previewLodgingEnrichment).mockReset();
    useToastStore.setState({ addToast });
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: true });
  });

  it("shows the matched house, its link and each field without writing", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue(PREVIEW);
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    const match = await screen.findByTestId("enrich-match");
    expect(match.textContent).toContain("openData:lodging.preview.found");
    expect(match.textContent).toContain('"name":"Adlon Kempinski"');
    expect(match.textContent).toContain('"type":"way"');
    expect(match.textContent).toContain('"m":40');
    expect(
      screen.getByRole("link", { name: "openData:lodging.preview.openMap" }).getAttribute("href")
    ).toBe("https://www.openstreetmap.org/way/123");
    expect(screen.getByTestId("enrich-field-stars").textContent).toContain(
      'openData:lodging.preview.keep {"current":"4 ★","proposed":"5 ★"}'
    );
    expect(screen.getByTestId("enrich-field-website").textContent).toContain(
      "openData:lodging.preview.fill"
    );
    expect(openDataApi.enrichLodging).not.toHaveBeenCalled();
  });

  it("writes nothing on cancel", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue(PREVIEW);
    const onDone = vi.fn();
    render(<LodgingEnrichButton lodgingId="l1" onDone={onDone} />);
    clickEnrich();
    await screen.findByTestId("enrich-match");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    await waitFor(() => expect(screen.queryByTestId("enrich-match")).toBeNull());
    expect(openDataApi.enrichLodging).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("applies exactly the previewed house and names it in the success message", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue(PREVIEW);
    vi.mocked(openDataApi.enrichLodging).mockResolvedValue({
      found: true,
      reason: null,
      osmRef: MATCH.osmRef,
      osmName: MATCH.name,
      filled: ["website"],
      match: MATCH,
      referenceStored: true,
    });
    const onDone = vi.fn();
    render(<LodgingEnrichButton lodgingId="l1" onDone={onDone} />);
    clickEnrich();
    await screen.findByTestId("enrich-match");
    fireEvent.click(screen.getByRole("button", { name: "openData:lodging.preview.apply" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(openDataApi.enrichLodging).toHaveBeenCalledWith("l1", "osm:way/123");
    const [kind, message] = addToast.mock.calls[0];
    expect(kind).toBe("success");
    expect(message).toContain("openData:lodging.applied");
    expect(message).toContain('"name":"Adlon Kempinski"');
    expect(message).toContain('"ref":"OSM way 123"');
    expect(message).toContain("openData:lodging.field.website");
  });

  it("says so when OpenStreetMap meanwhile names another house", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue(PREVIEW);
    vi.mocked(openDataApi.enrichLodging).mockResolvedValue({
      ...NOTHING,
      reason: "matchChanged",
      osmRef: null,
      osmName: null,
      filled: [],
      referenceStored: false,
    });
    const onDone = vi.fn();
    render(<LodgingEnrichButton lodgingId="l1" onDone={onDone} />);
    clickEnrich();
    await screen.findByTestId("enrich-match");
    fireEvent.click(screen.getByRole("button", { name: "openData:lodging.preview.apply" }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "openData:lodging.matchChanged")
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("offers no apply when there is nothing to take over", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue({
      ...PREVIEW,
      fields: [{ field: "stars", current: 4, proposed: 5, apply: false }],
      storesReference: false,
    });
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    await screen.findByText("openData:lodging.preview.nothingNew");
    expect(screen.queryByRole("button", { name: "openData:lodging.preview.apply" })).toBeNull();
  });
});

// Each way of finding nothing has its own message (2026-09-26 and 2026-10-22).
describe("LodgingEnrichButton — when nothing comes back", () => {
  const addToast = vi.fn();
  beforeEach(() => {
    addToast.mockReset();
    vi.mocked(openDataApi.previewLodgingEnrichment).mockReset();
    useToastStore.setState({ addToast });
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: true });
  });

  it("tells the reader when OpenStreetMap does not know the house", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue({
      ...NOTHING,
      reason: "notFound",
    });
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("info", "openData:lodging.notFound"));
    expect(screen.queryByTestId("enrich-match")).toBeNull();
  });

  it("says Overpass timed out instead of 'not found'", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockResolvedValue({
      ...NOTHING,
      reason: "timeout",
    });
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "openData:lodging.upstream.timeout")
    );
    expect(addToast).not.toHaveBeenCalledWith("info", "openData:lodging.notFound");
  });

  it("says a client-side timeout is a timeout, not a generic failure", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockRejectedValue({
      isAxiosError: true,
      code: "ECONNABORTED",
    });
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "openData:lodging.upstream.timeout")
    );
  });

  it("says the instance's open data switch is off", async () => {
    vi.mocked(openDataApi.previewLodgingEnrichment).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "openDataDisabled" } },
    });
    render(<LodgingEnrichButton lodgingId="l1" onDone={vi.fn()} />);
    clickEnrich();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "openData:lodging.disabled")
    );
  });
});
