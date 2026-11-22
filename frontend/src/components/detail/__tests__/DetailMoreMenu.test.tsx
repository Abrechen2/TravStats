import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const openData = vi.hoisted(() => ({ on: true }));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (sel: (s: { openDataEnabled: boolean }) => unknown) =>
    sel({ openDataEnabled: openData.on }),
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));
const preview = vi.fn();
vi.mock("../../../lib/api/openData", () => ({
  openDataApi: { previewLodgingEnrichment: (...a: unknown[]) => preview(...a) },
  isOpenDataDisabled: () => false,
  openDataUpstreamFailure: () => null,
}));

import DetailMoreMenu from "../DetailMoreMenu";

const onDelete = vi.fn();
const onMerge = vi.fn();

function renderMenu(withEnrich = true) {
  render(
    <MemoryRouter>
      <DetailMoreMenu
        entries={[{ key: "merge", label: "Merge", onSelect: onMerge }]}
        enrich={withEnrich ? { lodgingId: "l1", onDone: vi.fn() } : undefined}
        onDelete={onDelete}
      />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByTestId("detail-more-menu"));
}

const labels = () => screen.getAllByRole("menuitem").map((i) => i.textContent);

describe("DetailMoreMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openData.on = true;
  });

  it("offers the page's entry and the enrichment, with delete last — no share link (2026-11-22)", () => {
    renderMenu();
    expect(labels()).toEqual(["Merge", "openData:lodging.enrich", "common:buttons.delete"]);
  });

  it("asks the enrichment what it would fill when its entry is chosen", async () => {
    preview.mockResolvedValue({ found: false, reason: "notFound", match: null });
    renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "openData:lodging.enrich" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith("l1"));
  });

  it("leaves the enrichment out when open data is off", () => {
    openData.on = false;
    renderMenu();
    expect(labels()).toEqual(["Merge", "common:buttons.delete"]);
  });

  it("hands delete to the page's own confirmation instead of deleting", () => {
    renderMenu(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "common:buttons.delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
