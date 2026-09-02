import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagsSection from "../../components/DataQuality/DataQualityFlagsSection";
import { dataQualityFlagsApi } from "../../lib/api/dataQualityFlags";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The two answers must reach two DIFFERENT endpoints, and the wiring is the
 * only place that can get that wrong silently: the labels can read correctly
 * while both buttons post to `/dismiss`, and the user would then be hiding
 * faults while believing they had reported corrections.
 */

vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: {
    getAll: vi.fn(),
    resolve: vi.fn(),
    dismiss: vi.fn(),
    run: vi.fn(),
  },
}));

const addToast = vi.fn();
// One frozen state object, selected out of — the way zustand behaves. Building
// a fresh `{ addToast: (...) => ... }` per call hands the component a new
// function identity on every render, which re-creates its `loadFlags` callback
// and re-fires the effect that depends on it; the section then refetches
// forever and the fetch counts below become meaningless.
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const flag: DataQualityFlag = {
  id: "flag-42",
  entityType: "lodging",
  entityId: "lodging-1",
  kind: "address_country_mismatch",
  status: "open",
  subject: { entityType: "lodging", entityId: "lodging-1", label: "Hotel Sport" },
  details: {
    claimedCountryCode: "RO",
    claimedCountryText: "Rumänien",
    addressCountryCode: "SI",
    addressCountryText: "Slovenia",
    address: "Grajska cesta 2, Otočec, Slovenia",
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  resolvedAt: null,
};

async function renderSection() {
  vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
  render(
    <MemoryRouter>
      <DataQualityFlagsSection />
    </MemoryRouter>
  );
  await screen.findByText("Hotel Sport");
}

describe("DataQualityFlagsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the open questions by default", async () => {
    await renderSection();
    expect(dataQualityFlagsApi.getAll).toHaveBeenCalledWith({ status: "open" });
  });

  it("sends 'I have corrected it' to resolve, and nothing else", async () => {
    vi.mocked(dataQualityFlagsApi.resolve).mockResolvedValue({ success: true });
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:flag.actions.resolve.label" })
    );

    await waitFor(() => expect(dataQualityFlagsApi.resolve).toHaveBeenCalledWith("flag-42"));
    expect(dataQualityFlagsApi.dismiss).not.toHaveBeenCalled();
  });

  it("sends 'this is correct as it is' to dismiss, and nothing else", async () => {
    vi.mocked(dataQualityFlagsApi.dismiss).mockResolvedValue({ success: true });
    await renderSection();

    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:flag.actions.dismiss.label" })
    );

    await waitFor(() => expect(dataQualityFlagsApi.dismiss).toHaveBeenCalledWith("flag-42"));
    expect(dataQualityFlagsApi.resolve).not.toHaveBeenCalled();
  });

  it("re-runs the checks and reloads", async () => {
    vi.mocked(dataQualityFlagsApi.run).mockResolvedValue({
      opened: 0,
      reopened: 0,
      updated: 0,
      autoResolved: 1,
      open: 0,
    });
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: "dataQuality:inbox.review.recheck" }));

    await waitFor(() => expect(dataQualityFlagsApi.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dataQualityFlagsApi.getAll).toHaveBeenCalledTimes(2));
  });

  it("reports a load failure instead of rendering an empty inbox silently", async () => {
    vi.mocked(dataQualityFlagsApi.getAll).mockRejectedValue(new Error("boom"));
    render(
      <MemoryRouter>
        <DataQualityFlagsSection />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "dataQuality:inbox.errors.loadFailed")
    );
  });
});
