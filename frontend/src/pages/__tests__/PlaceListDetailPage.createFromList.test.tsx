import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A new place straight from a list (forgejo#230). A search that found nothing
 * used to say "Lege ihn zuerst unter „Orte“ an" — leave the list, create the
 * place, come back, search again, add it.
 */

const getPlaceList = vi.fn();
const addPlaceToList = vi.fn();
const formProps = vi.hoisted(() => ({
  last: null as null | Record<string, unknown>,
  saves: null as null | Record<string, unknown>,
}));

vi.mock("../../lib/api/placeLists", () => ({
  getPlaceList: (...a: unknown[]) => getPlaceList(...a),
  addPlaceToList: (...a: unknown[]) => addPlaceToList(...a),
  updatePlaceList: vi.fn(),
  reorderPlaceList: vi.fn(),
  removePlaceFromList: vi.fn(),
  deletePlaceList: vi.fn(),
}));
vi.mock("../../lib/api/places", () => ({
  listPlaces: vi.fn(async () => [
    { id: "a", name: "Pantheon", category: "landmark", city: "Rom", country: null },
    {
      id: "c",
      name: "Trevi Fountain",
      localName: "Fontana di Trevi",
      category: "landmark",
      city: "Rom",
      country: null,
    },
    { id: "m", name: "Kolosseum", category: "landmark", city: "Rom", country: null },
  ]),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/places/PlaceListLabelFields", () => ({
  PlaceListLabelFields: () => null,
  hasSymbol: (v: string) => v.trim().length > 0,
}));
// The form has its own tests; here it stands for "the user saved a new place".
vi.mock("../../components/places/PlaceFormModal", () => ({
  PlaceFormModal: (props: Record<string, unknown>) => {
    formProps.last = props;
    const onSaved = props.onSaved as (p: unknown) => void;
    return (
      <div role="dialog" aria-label="place-form">
        <button type="button" onClick={() => onSaved(formProps.saves ?? CREATED)}>
          mock-save
        </button>
      </div>
    );
  },
}));

import PlaceListDetailPage from "../PlaceListDetailPage";
import { allNamed, findNamed, getNamed, queryNamed } from "../../__tests__/helpers/namedElement";

const CREATED = { id: "new", name: "Bocca della Verità", category: "landmark", city: null };

const LIST = {
  id: "l1",
  name: "Rom",
  color: "#f0a947",
  icon: null,
  curatedKey: null,
  labelMode: "name",
  sortIdx: 0,
  description: null,
  placeCount: 0,
  visitedCount: 0,
  countryCount: 0,
  createdAt: "",
  updatedAt: "",
  entries: [
    {
      id: "e0",
      placeId: "m",
      sortIdx: 0,
      place: { id: "m", name: "Kolosseum", category: "landmark", city: "Rom", visited: false },
    },
  ],
};

const withNew = {
  ...LIST,
  placeCount: 1,
  entries: [
    ...LIST.entries,
    { id: "e1", placeId: "new", sortIdx: 1, place: { ...CREATED, visited: false } },
  ],
};

async function searchForNothing(): Promise<void> {
  render(
    <MemoryRouter initialEntries={["/places/lists/l1"]}>
      <Routes>
        <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  fireEvent.change(await screen.findByLabelText("Ort hinzufügen"), {
    target: { value: "Bocca della Verità" },
  });
}

const network = { isAxiosError: true, message: "Network Error" };

describe("PlaceListDetailPage — a new place from the list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formProps.last = null;
    formProps.saves = null;
    getPlaceList.mockResolvedValue(LIST);
  });

  it("offers to create the place when the search finds nothing, named as typed", async () => {
    await searchForNothing();
    expect(screen.getByText("Kein passender Ort in deinem Logbuch.")).toBeInTheDocument();

    fireEvent.click(getNamed("button", "„Bocca della Verità“ als Ort anlegen und hinzufügen"));
    expect(screen.getByRole("dialog", { name: "place-form" })).toBeInTheDocument();
    expect(formProps.last).toMatchObject({ initialName: "Bocca della Verità", forList: "Rom" });
  });

  it("returns to the list and files the new place in it exactly once", async () => {
    addPlaceToList.mockResolvedValue(withNew);
    await searchForNothing();
    fireEvent.click(getNamed("button", /als Ort anlegen/));
    fireEvent.click(getNamed("button", "mock-save"));

    await waitFor(() => expect(addPlaceToList).toHaveBeenCalledWith("l1", "new"));
    expect(addPlaceToList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "place-form" })).not.toBeInTheDocument();
    expect(await findNamed("link", "Bocca della Verità")).toBeInTheDocument();
    expect(screen.getByLabelText("Ort hinzufügen")).toHaveValue("");
  });

  it("keeps the saved place when only the filing fails, and files it again on request", async () => {
    addPlaceToList.mockRejectedValueOnce(network).mockResolvedValueOnce(withNew);
    await searchForNothing();
    fireEvent.click(getNamed("button", /als Ort anlegen/));
    fireEvent.click(getNamed("button", "mock-save"));

    const row = await screen.findByRole("alert");
    expect(row).toHaveTextContent(
      "„Bocca della Verità“ ist gespeichert, steht aber noch nicht in dieser Liste."
    );
    expect(row).toHaveTextContent("Der Server ist nicht erreichbar");

    // Two quick taps send one request.
    const again = getNamed("button", "Erneut zuordnen");
    await act(async () => {
      fireEvent.click(again);
      fireEvent.click(again);
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(addPlaceToList).toHaveBeenCalledTimes(2);
    expect(addPlaceToList).toHaveBeenLastCalledWith("l1", "new");
    expect(getNamed("link", "Bocca della Verità")).toBeInTheDocument();
  });

  it("the row can be hidden — the place stays in the logbook either way", async () => {
    addPlaceToList.mockRejectedValue(network);
    await searchForNothing();
    fireEvent.click(getNamed("button", /als Ort anlegen/));
    fireEvent.click(getNamed("button", "mock-save"));
    await screen.findByRole("alert");
    fireEvent.click(getNamed("button", "Ausblenden"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not offer to create while the search still finds a place", async () => {
    await searchForNothing();
    fireEvent.change(screen.getByLabelText("Ort hinzufügen"), { target: { value: "Panth" } });
    expect(getNamed("button", /Pantheon/)).toBeInTheDocument();
    expect(queryNamed("button", /als Ort anlegen/)).not.toBeInTheDocument();
  });

  // Review I3: a member is said as a member, never offered as "new".
  it("says a place is already in the list instead of offering to create it again", async () => {
    await searchForNothing();
    fireEvent.change(screen.getByLabelText("Ort hinzufügen"), { target: { value: "Kolosseum" } });
    expect(screen.getByText("„Kolosseum“ steht schon in dieser Liste.")).toBeInTheDocument();
    expect(queryNamed("button", /als Ort anlegen/)).not.toBeInTheDocument();
    expect(screen.queryByText("Kein passender Ort in deinem Logbuch.")).not.toBeInTheDocument();
  });

  it("finds a place by the name on the sign", async () => {
    await searchForNothing();
    fireEvent.change(screen.getByLabelText("Ort hinzufügen"), {
      target: { value: "Fontana di" },
    });
    expect(getNamed("button", /Trevi Fountain/)).toBeInTheDocument();
    expect(queryNamed("button", /als Ort anlegen/)).not.toBeInTheDocument();
  });

  // Review M2: a create the server answered with an existing place lists it once.
  it("lists a place the create answered with (deduped) only once", async () => {
    formProps.saves = {
      id: "a",
      name: "Pantheon",
      category: "landmark",
      city: "Rom",
      country: null,
    };
    addPlaceToList.mockRejectedValue(network);
    await searchForNothing();
    fireEvent.click(getNamed("button", /als Ort anlegen/));
    fireEvent.click(getNamed("button", "mock-save"));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Ort hinzufügen"), { target: { value: "Panth" } });
    expect(allNamed("button", /Pantheon/)).toHaveLength(1);
  });
});
