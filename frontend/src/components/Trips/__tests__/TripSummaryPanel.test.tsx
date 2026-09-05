import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const summarize = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { summarize: (...args: unknown[]) => summarize(...args) },
}));

vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ betaFeaturesEnabled: true, isFeatureVisible: () => true }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import { TripSummaryPanel, summaryLanguageOf } from "../TripSummaryPanel";
import type { Trip } from "../../../types";

const trip = { id: "t1", name: "Köln", summary: null } as unknown as Trip;
const t = (k: string) => k;

/**
 * Until 2026-09-05 the server wrote German for everyone. The reader's UI
 * language now travels with the request, so an English reader of a German
 * instance gets an English summary — the panel is where that decision is
 * made, and it is pinned here.
 */
describe("TripSummaryPanel — the summary is written in the reader's language", () => {
  beforeEach(() => {
    summarize.mockReset();
    summarize.mockResolvedValue({ summary: "…", model: "m", language: "en", durationMs: 1 });
  });

  it("asks for an English summary when the UI is English", async () => {
    render(<TripSummaryPanel trip={trip} t={t} language="en-GB" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("trips:summary.generateButton"));
    await waitFor(() => expect(summarize).toHaveBeenCalledWith("t1", "en"));
  });

  it("asks for German when the UI is German", async () => {
    render(<TripSummaryPanel trip={trip} t={t} language="de" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("trips:summary.generateButton"));
    await waitFor(() => expect(summarize).toHaveBeenCalledWith("t1", "de"));
  });

  it("maps any other UI language to German, the app's primary language", () => {
    expect(summaryLanguageOf("fr")).toBe("de");
    expect(summaryLanguageOf("EN")).toBe("en");
    expect(summaryLanguageOf("en-US")).toBe("en");
  });
});
