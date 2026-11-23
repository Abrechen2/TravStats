import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: { count?: number }) =>
      o?.count !== undefined ? `${key}:${o.count}` : key,
    i18n: { language: "de" },
  }),
}));
const listPlaceLists = vi.fn();
const listCuratedChecklists = vi.fn();
vi.mock("../../../../lib/api/placeLists", () => ({
  listPlaceLists: (...a: unknown[]) => listPlaceLists(...a),
  listCuratedChecklists: (...a: unknown[]) => listCuratedChecklists(...a),
}));

import { PlaceListPicker } from "../PlaceListPicker";
import { usePlaceListFilterStore } from "../../../../store/placeListFilterStore";

beforeEach(() => {
  window.localStorage.clear();
  usePlaceListFilterStore.setState({ selection: [], viewActive: false });
  listPlaceLists.mockResolvedValue([
    { id: "macs", name: "McDonald", curatedKey: null },
    { id: "sub", name: "Weltwunder (Abo)", curatedKey: "wonders" },
  ]);
  listCuratedChecklists.mockResolvedValue([
    { key: "wonders", name: "7 Weltwunder", nameEn: "7 Wonders" },
  ]);
});

describe("PlaceListPicker", () => {
  it("offers own lists and curated lists once each, and 'Alle Orte' as the default", async () => {
    render(<PlaceListPicker touch={false} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() => expect(screen.getByText("McDonald")).toBeInTheDocument());
    expect(screen.getByText("7 Weltwunder")).toBeInTheDocument();
    expect(screen.queryByText("Weltwunder (Abo)")).not.toBeInTheDocument();
    expect(screen.getByTestId("place-list-choice-all")).toHaveAttribute("aria-checked", "true");
  });

  it("chooses and unchooses lists, 'Alle Orte' clears the choice", async () => {
    render(<PlaceListPicker touch />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() => screen.getByText("McDonald"));
    fireEvent.click(screen.getByTestId("place-list-choice-list:macs"));
    fireEvent.click(screen.getByTestId("place-list-choice-curated:wonders"));
    expect(usePlaceListFilterStore.getState().selection).toEqual(["list:macs", "curated:wonders"]);
    fireEvent.click(screen.getByTestId("place-list-choice-all"));
    expect(usePlaceListFilterStore.getState().selection).toEqual([]);
  });

  it("says so when the lists cannot be loaded, instead of showing an empty picker", async () => {
    listPlaceLists.mockRejectedValue(new Error("boom"));
    render(<PlaceListPicker touch={false} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("placeLists.loadFailed");
  });
});
