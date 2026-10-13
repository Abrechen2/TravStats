import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import { flightsApi } from "../../../../lib/api/flights";
import { getLodging } from "../../../../lib/api/lodging";
import { getPlace } from "../../../../lib/api/places";
import type { Flight, FlightInput } from "../../../../types";
import type { Lodging } from "../../../../types/lodging";
import type { Place, PlaceVisit } from "../../../../types/place";
import RecordEditButton from "../RecordEditButton";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));
vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getById: vi.fn(), update: vi.fn() },
}));
vi.mock("../../../../lib/api/lodging", () => ({ getLodging: vi.fn() }));
vi.mock("../../../../lib/api/places", () => ({ getPlace: vi.fn() }));
vi.mock("../../../FlightEditModal", () => ({
  default: ({
    flight,
    onSave,
    onAfterSave,
  }: {
    flight: Flight;
    onSave: (id: string, patch: Partial<FlightInput>) => Promise<void>;
    onAfterSave: () => void;
  }) => (
    <button
      onClick={async () => {
        await onSave(flight.id, { flightNumber: "LH123" });
        onAfterSave();
      }}
    >
      Save flight {flight.flightNumber}
    </button>
  ),
}));
vi.mock("../../../places/VisitDialog", () => ({
  VisitDialog: ({
    place,
    visit,
    onSaved,
  }: {
    place: Place;
    visit: PlaceVisit;
    onSaved: () => void;
  }) => (
    <button onClick={onSaved}>
      Save visit {visit.id} at {place.name}
    </button>
  ),
}));

describe("inbox record editors", () => {
  beforeEach(() => vi.resetAllMocks());
  it("loads the current flight only on demand, saves through the validated editor and rechecks afterwards", async () => {
    const onSaved = vi.fn();
    vi.mocked(flightsApi.getById).mockResolvedValue({ id: "f1", flightNumber: "LH122" } as Flight);
    render(
      <RecordEditButton entityType="flight" entityId="f1" disabled={false} onSaved={onSaved} />
    );
    expect(flightsApi.getById).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Hier bearbeiten" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save flight LH122" }));
    expect(flightsApi.update).toHaveBeenCalledWith("f1", { flightNumber: "LH123" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("refuses a disappeared stay instead of opening the creation form", async () => {
    vi.mocked(getLodging).mockResolvedValue({ id: "hotel1", stays: [] } as unknown as Lodging);
    render(
      <RecordEditButton
        entityType="lodging_stay"
        entityId="stay1"
        parentId="hotel1"
        disabled={false}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Hier bearbeiten" }));
    expect(getLodging).toHaveBeenCalledWith("hotel1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Eintrag konnte nicht geladen werden"
    );
  });

  it("opens precisely the existing visit on its parent place", async () => {
    const onSaved = vi.fn();
    vi.mocked(getPlace).mockResolvedValue({
      id: "place1",
      name: "Belém",
      visits: [{ id: "visit1" }, { id: "visit2" }],
    } as unknown as Place);
    render(
      <RecordEditButton
        entityType="place_visit"
        entityId="visit2"
        parentId="place1"
        disabled={false}
        onSaved={onSaved}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Hier bearbeiten" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Save visit visit2 at Belém" })
    );
    expect(getPlace).toHaveBeenCalledWith("place1");
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
