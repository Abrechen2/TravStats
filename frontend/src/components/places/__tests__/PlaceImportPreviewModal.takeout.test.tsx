import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlaceImportPreviewModal } from "../PlaceImportPreviewModal";
import { JobFailedError } from "../../../lib/api/jobs";
import type {
  PlaceImportCandidate,
  PlaceImportPreviewRow,
  PlaceImportResolution,
} from "../../../types/placeImport";

/**
 * #358 in the preview: a Google Takeout list is resolved on the user's click,
 * the suggestions land on the rows visibly, a station or fuel stop is offered
 * as a trip stop and a matched hotel as the user's stay — and when the lookup
 * fails, the failure is said, not swallowed. No network: the API is mocked.
 */

const resolvePlaceImport = vi.fn();
vi.mock("../../../lib/api/placeImport", () => ({
  resolvePlaceImport: (...args: unknown[]) => resolvePlaceImport(...args),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const takeoutRow = (i: number, name: string): PlaceImportPreviewRow => ({
  sourceRowIndex: i,
  name,
  lat: null,
  lon: null,
  externalRef: `gmaps:${100 + i}`,
  flags: ["missing_coordinates"],
  dedupeHint: "none",
  matchedPlaceId: null,
  action: "needs_input",
});

const rows = [
  takeoutRow(0, "Invented Shrine"),
  takeoutRow(1, "Invented Fuel"),
  takeoutRow(2, "Invented Inn"),
  takeoutRow(3, "Invented Café"),
];

const position = (lat: number) => ({
  lat,
  lon: 135,
  source: "google_cid" as const,
  address: null,
  city: "Kyoto",
  country: "Japan",
});

const resolution: PlaceImportResolution = {
  listCountry: "JP",
  trip: { id: "11111111-1111-4111-8111-111111111111", name: "Japan", first: null, last: null },
  tripReason: null,
  googleConfigured: true,
  rows: [
    {
      sourceRowIndex: 0,
      position: position(35),
      cidReason: null,
      positionReason: null,
      kind: "sight",
      suggestedTreatment: "place",
      visitDay: { date: "2024-04-05", photoCount: 2 },
      visitDayReason: null,
      matchedStay: null,
    },
    {
      sourceRowIndex: 1,
      position: position(35.1),
      cidReason: null,
      positionReason: null,
      kind: "fuel",
      suggestedTreatment: "trip_stop",
      visitDay: null,
      visitDayReason: "no_photos",
      matchedStay: null,
    },
    {
      sourceRowIndex: 2,
      position: position(35.2),
      cidReason: null,
      positionReason: null,
      kind: "lodging",
      suggestedTreatment: "stay",
      visitDay: null,
      visitDayReason: "no_photos",
      matchedStay: { id: "22222222-2222-4222-8222-222222222222", name: "Inn", checkIn: null },
    },
    {
      sourceRowIndex: 3,
      position: null,
      cidReason: "quota",
      positionReason: "not_in_country",
      kind: "sight",
      suggestedTreatment: "place",
      visitDay: null,
      visitDayReason: "no_position",
      matchedStay: null,
    },
  ],
};

type CommitFn = (rows: PlaceImportCandidate[]) => Promise<void>;

function renderModal(input = rows, onCommit = vi.fn<CommitFn>(async () => {})) {
  render(
    <PlaceImportPreviewModal
      rows={input}
      summary={{ newRows: 0, alreadyPresent: 0, needsInput: input.length }}
      listName="Japan.csv"
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
  return onCommit;
}

describe("PlaceImportPreviewModal — Google Takeout suggestions", () => {
  beforeEach(() => {
    resolvePlaceImport.mockReset();
  });

  it("resolves on click and shows each suggestion on its row", async () => {
    resolvePlaceImport.mockResolvedValue(resolution);
    renderModal();

    // Nothing is looked up until the user asks: it spends the Google quota.
    expect(resolvePlaceImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("takeout-resolve"));
    await waitFor(() => expect(screen.getByTestId("takeout-summary")).toBeInTheDocument());

    expect(resolvePlaceImport.mock.calls[0][0]).toBe("Japan.csv");
    expect(screen.getByTestId("place-import-position-0")).toHaveTextContent("35.0000 · 135.0000");
    expect(screen.getByTestId("place-import-source-0")).toBeInTheDocument();
    expect(screen.getByTestId("place-import-day-0")).toBeInTheDocument();
    expect((screen.getByTestId("place-import-action-1") as HTMLSelectElement).value).toBe(
      "trip_stop"
    );
    expect((screen.getByTestId("place-import-action-2") as HTMLSelectElement).value).toBe("stay");
    // The unplaced row stays undecided and says why.
    expect((screen.getByTestId("place-import-action-3") as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("place-import-reason-3")).toHaveTextContent(
      "places:import.takeout.positionReasons.not_in_country"
    );
    // The quota failure is named even though it is "only" Google's problem.
    expect(screen.getByTestId("takeout-google-failures")).toHaveTextContent(
      "places:import.takeout.positionReasons.quota"
    );
    expect(screen.getByTestId("takeout-trip")).toHaveTextContent(
      "places:import.takeout.trip.found"
    );
  });

  it("commits each row with the treatment the user kept", async () => {
    resolvePlaceImport.mockResolvedValue(resolution);
    const onCommit = renderModal();
    fireEvent.click(screen.getByTestId("takeout-resolve"));
    await waitFor(() => expect(screen.getByTestId("takeout-summary")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("place-import-action-3"), { target: { value: "skip" } });
    fireEvent.click(screen.getByTestId("place-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const payload = onCommit.mock.calls[0][0];
    expect(payload.map((r) => r.sourceRowIndex)).toEqual([0, 1, 2]);
    expect(payload[0]).toMatchObject({
      lat: 35,
      visitedAt: "2024-04-05",
      tripId: resolution.trip?.id,
    });
    expect(payload[0]).not.toHaveProperty("treatment");
    expect(payload[1]).toMatchObject({ treatment: "trip_stop", tripId: resolution.trip?.id });
    expect(payload[2]).toMatchObject({
      treatment: "stay",
      lodgingStayId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("says that no Google key is configured", async () => {
    resolvePlaceImport.mockResolvedValue({ ...resolution, googleConfigured: false });
    renderModal();
    fireEvent.click(screen.getByTestId("takeout-resolve"));
    expect(await screen.findByTestId("takeout-no-key")).toHaveTextContent(
      "places:import.takeout.noKey"
    );
  });

  it("names a failed lookup and leaves the rows as they were", async () => {
    resolvePlaceImport.mockImplementation(async () => {
      throw new JobFailedError("JOB_FAILED", 500);
    });
    renderModal();
    fireEvent.click(screen.getByTestId("takeout-resolve"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "places:import.takeout.errors.failed"
    );
    expect(screen.getByTestId("place-import-pick-0")).toBeInTheDocument();
    expect(screen.getByTestId("place-import-commit")).toBeDisabled();
  });

  it("offers no lookup when every row is already placed and carries no Maps identity", () => {
    renderModal([
      {
        ...takeoutRow(0, "Placed"),
        lat: 1,
        lon: 1,
        externalRef: null,
        flags: [],
        action: "create",
      },
    ]);
    expect(screen.queryByTestId("takeout-resolve-panel")).not.toBeInTheDocument();
  });
});
