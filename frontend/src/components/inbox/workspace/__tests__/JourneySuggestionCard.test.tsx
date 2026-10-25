import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { LocationSuggestion } from "../../../../lib/api/locationSuggestions";
import type { RailFormDraft } from "../../../rail/railFormModel";
import { pendingLink, savePendingLink } from "../journeyPrefill";
import { run } from "./journeyRun";

const api = vi.hoisted(() => ({
  acceptJourneyRun: vi.fn(),
  closeJourneyRuns: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../../../../lib/api/locationSuggestions", () => ({ locationSuggestionsApi: api }));
vi.mock("../../../../hooks/useDomainVisible", () => ({ useDomainVisible: () => true }));

/** The rail form, reduced to what the card hands it and what it hands back. */
const railForm = vi.hoisted(() => ({ draft: null as RailFormDraft | null }));
vi.mock("../../../rail/RailFormModal", () => ({
  RailFormModal: (props: {
    initialDraft: RailFormDraft;
    onSaved: (ride: { id: string }) => Promise<void>;
  }) => {
    railForm.draft = props.initialDraft;
    return (
      <button type="button" onClick={() => void props.onSaved({ id: "ride-1" })}>
        save-rail-form
      </button>
    );
  },
}));
vi.mock("../../../bus/BusFormModal", () => ({ BusFormModal: () => null }));
vi.mock("../../../Roadtrips/NewRoadtripDialog", () => ({ default: () => null }));

import JourneySuggestionCard from "../JourneySuggestionCard";

const J = "dataQuality:inbox.workspace.journey";

const suggestion: LocationSuggestion = {
  id: "s1",
  kind: "journey",
  provider: { kind: "travtrack", rev: 1 },
  window: { fromMs: run.fromMs, untilMs: run.untilMs + 1 },
  algorithm: { name: "journey", version: 1 },
  explanation: { code: "journey.unlogged", params: { runs: 1, km: 150 } },
  status: "pending",
  coverage: "complete",
  journey: { day: "2026-10-20", zone: "Europe/Berlin", runs: [run] },
};

const refusal = (code: string) =>
  Object.assign(new Error(code), {
    isAxiosError: true,
    response: { status: 400, data: { code, error: code } },
  });

describe("JourneySuggestionCard", () => {
  const reload = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    railForm.draft = null;
  });
  afterEach(() => localStorage.clear());

  it("prefill opens the rail form with times and both ends, then links the saved ride", async () => {
    api.acceptJourneyRun.mockResolvedValue(suggestion);
    render(<JourneySuggestionCard suggestion={suggestion} disabled={false} reload={reload} />);
    expect(screen.getByText(`${J}.endNotRecorded`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${J}.enter.rail` }));
    expect(railForm.draft).toMatchObject({
      departure: { lat: run.start.lat, lon: run.start.lon },
      arrival: { lat: run.end.lat, lon: run.end.lon },
      departureLocal: "2026-10-20T06:32",
    });
    fireEvent.click(screen.getByRole("button", { name: "save-rail-form" }));
    await waitFor(() =>
      expect(api.acceptJourneyRun).toHaveBeenCalledWith("s1", {
        runIndex: 0,
        entryKind: "rail",
        entryId: "ride-1",
      })
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(pendingLink("s1", 0)).toBeNull();
  });

  it("a saved form whose accept failed offers the link next time", async () => {
    api.acceptJourneyRun.mockRejectedValueOnce(refusal("VALIDATION_FAILED"));
    const { unmount } = render(
      <JourneySuggestionCard suggestion={suggestion} disabled={false} reload={reload} />
    );
    fireEvent.click(screen.getByRole("button", { name: `${J}.enter.rail` }));
    fireEvent.click(screen.getByRole("button", { name: "save-rail-form" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${J}.errors.entryMismatch`);
    expect(pendingLink("s1", 0)).toEqual({ entryKind: "rail", entryId: "ride-1" });
    unmount();

    api.acceptJourneyRun.mockResolvedValueOnce(suggestion);
    render(<JourneySuggestionCard suggestion={suggestion} disabled={false} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: `${J}.linkSaved` }));
    await waitFor(() =>
      expect(api.acceptJourneyRun).toHaveBeenLastCalledWith("s1", {
        runIndex: 0,
        entryKind: "rail",
        entryId: "ride-1",
      })
    );
    await waitFor(() => expect(pendingLink("s1", 0)).toBeNull());
  });

  it("an invalidated journey says so and reloads; TravTrack off keeps the card", async () => {
    savePendingLink("s1", 0, { entryKind: "bus", entryId: "b1" });
    api.acceptJourneyRun.mockRejectedValueOnce(refusal("EVIDENCE_INVALIDATED"));
    render(<JourneySuggestionCard suggestion={suggestion} disabled={false} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: `${J}.linkSaved` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${J}.errors.invalidated`);
    expect(reload).toHaveBeenCalled();

    reload.mockClear();
    api.acceptJourneyRun.mockRejectedValueOnce(refusal("TRAVTRACK_DISABLED"));
    fireEvent.click(screen.getByRole("button", { name: `${J}.linkSaved` }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(`${J}.errors.disabled`)
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("no entry needed closes the run", async () => {
    api.closeJourneyRuns.mockResolvedValue(suggestion);
    render(<JourneySuggestionCard suggestion={suggestion} disabled={false} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: `${J}.noEntry` }));
    await waitFor(() => expect(api.closeJourneyRuns).toHaveBeenCalledWith("s1", 0));
  });
});
