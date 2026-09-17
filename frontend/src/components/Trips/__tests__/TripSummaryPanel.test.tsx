import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const summarize = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { summarize: (...args: unknown[]) => summarize(...args) },
}));

vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ betaFeaturesEnabled: true, isFeatureVisible: () => true }),
}));

const demoState = vi.hoisted(() => ({ shared: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => demoState.shared,
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

/**
 * Generating spends the OPERATOR's Ollama, which on a public instance is lent
 * to whoever knows the demo password — the same trade the Immich and Dawarich
 * resolvers already refuse that account. The server refuses the route; these
 * cases pin that the button goes with it, so nothing on screen offers what the
 * next click cannot do.
 */
describe("TripSummaryPanel — the shared demo account is offered no generation", () => {
  beforeEach(() => {
    summarize.mockReset();
    demoState.shared = true;
  });

  afterEach(() => {
    demoState.shared = false;
  });

  it("renders no card at all when there is nothing to show", () => {
    const { container } = render(
      <TripSummaryPanel trip={trip} t={t} language="de" onChanged={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("trips:summary.generateButton")).toBeNull();
  });

  it("still shows a summary that already exists, without the regenerate control", () => {
    const withSummary = { ...trip, summary: "Elf Tage um die Insel." } as unknown as Trip;
    render(<TripSummaryPanel trip={withSummary} t={t} language="de" onChanged={vi.fn()} />);
    expect(screen.getByText("Elf Tage um die Insel.")).toBeInTheDocument();
    expect(screen.queryByText("trips:summary.regenerate")).toBeNull();
  });

  it("offers generation to an ordinary account", () => {
    demoState.shared = false;
    render(<TripSummaryPanel trip={trip} t={t} language="de" onChanged={vi.fn()} />);
    expect(screen.getByText("trips:summary.generateButton")).toBeInTheDocument();
  });
});
