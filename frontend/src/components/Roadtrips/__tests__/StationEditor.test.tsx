import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import StationEditor from "../StationEditor";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
// The location search talks to a geocoder and draws a map; the editor only
// needs "a point was chosen", so the test chooses one directly.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
  }: {
    onChange: (s: { lat: number; lon: number; name: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ lat: 58.97, lon: 5.73, name: "Stavanger" })}>
      pick-location
    </button>
  ),
}));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([
    {
      id: "l1",
      name: "Mosvangen Camping",
      stays: [
        { id: "stay-1", checkIn: "2026-07-14T00:00:00.000Z", checkOut: "2026-07-16T00:00:00.000Z" },
      ],
    },
  ]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
}));

describe("StationEditor", () => {
  const onSave = vi.fn();
  beforeEach(() => onSave.mockReset());

  function renderEditor() {
    return render(
      <StationEditor
        initial={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Hamburg",
            lat: 53.55,
            lon: 9.99,
            night: { kind: "pass" },
          },
        ]}
        initialStayLabels={{}}
        tripId={null}
        saving={false}
        onSave={onSave}
        onCancel={() => {}}
      />
    );
  }

  it("will not save a station that has no location yet", () => {
    renderEditor();
    fireEvent.click(screen.getByText("roadtrips:stations.add"));
    expect(screen.getByText("roadtrips:stations.save")).toBeDisabled();
    expect(screen.getByText("roadtrips:stations.incomplete")).toBeInTheDocument();
  });

  it("takes the place name as the title and saves a free night by default", () => {
    renderEditor();
    fireEvent.click(screen.getByText("roadtrips:stations.add"));
    fireEvent.click(screen.getAllByText("pick-location")[1]);
    fireEvent.click(screen.getByText("roadtrips:stations.save"));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ title: "Hamburg", night: { kind: "pass" } }),
      expect.objectContaining({
        title: "Stavanger",
        lat: 58.97,
        lon: 5.73,
        night: { kind: "free" },
      }),
    ]);
  });

  it("does not store a stay night without a stay — it opens the picker instead", async () => {
    renderEditor();
    fireEvent.click(screen.getAllByRole("radio", { name: "roadtrips:night.stay" })[0]);
    // Still a pass until a stay is actually picked.
    expect(screen.getAllByRole("radio", { name: "roadtrips:night.pass" })[0]).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(await screen.findByLabelText("roadtrips:stay.search")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("roadtrips:stay.search"), {
      target: { value: "Mosv" },
    });
    fireEvent.click(await screen.findByText(/Mosvangen Camping/));
    fireEvent.click(screen.getByText("roadtrips:stations.save"));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        title: "Hamburg",
        night: { kind: "stay", lodgingStayId: "stay-1" },
        // The stay's dates fill the station's empty ones.
        startDate: "2026-07-14T00:00:00.000Z",
      }),
    ]);
  });
});
