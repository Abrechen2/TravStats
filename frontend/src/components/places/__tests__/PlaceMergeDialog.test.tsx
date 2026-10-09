/**
 * Merging two of the user's places (forgejo#232): pick the duplicate, compare,
 * choose each value explicitly, see what moves — then one request. Read
 * through the real German resources.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Place } from "../../../types/place";

const listPlaces = vi.fn();
const mergePlace = vi.fn();
const getPlaceRelations = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  listPlaces: (...a: unknown[]) => listPlaces(...a),
  mergePlace: (...a: unknown[]) => mergePlace(...a),
  getPlaceRelations: (...a: unknown[]) => getPlaceRelations(...a),
}));
vi.mock("../../../lib/api/placeLists", () => ({
  listCuratedChecklists: vi.fn(async () => [
    { key: "world-heritage", name: "UNESCO-Welterbe", nameEn: "UNESCO World Heritage" },
    { key: "world-wonders-new7", name: "Neue 7 Weltwunder", nameEn: "New 7 Wonders" },
  ]),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import { PlaceMergeDialog } from "../PlaceMergeDialog";
import { mergeFields, openGroups } from "../placeMergeModel";

const base = {
  localName: null,
  address: null,
  isoCountryCode: "IT",
  externalRef: null,
  curatedItemId: null,
  dataSource: null,
  createdAt: "",
  updatedAt: "",
  visits: [],
  visitCount: 0,
  plannedVisitCount: 0,
  lastVisitAt: null,
  continent: null,
};

const KOLOSSEUM = {
  ...base,
  id: "t",
  name: "Kolosseum",
  category: "landmark",
  lat: 41.89,
  lon: 12.49,
  city: "Rom",
  country: "Italien",
  notes: null,
  visited: false,
} as unknown as Place;

const COLOSSEUM = {
  ...base,
  id: "s",
  name: "Colosseum",
  category: "landmark",
  lat: 41.8902,
  lon: 12.4922,
  city: "Roma",
  country: "Italy",
  notes: null,
  visited: true,
} as unknown as Place;

const FAR = {
  ...base,
  id: "far",
  name: "Brandenburger Tor",
  category: "landmark",
  lat: 52.5163,
  lon: 13.3777,
  city: "Berlin",
  country: "Deutschland",
  notes: null,
  visited: true,
} as unknown as Place;

const RELATIONS = {
  visitCount: 2,
  plannedVisitCount: 0,
  photoCount: 3,
  documentCount: 1,
  lists: [{ id: "l", name: "Antike" }],
  trips: [],
  roadtripStationCount: 0,
};

async function openDialog(): Promise<{
  onMerged: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}> {
  const onMerged = vi.fn();
  const onClose = vi.fn();
  render(<PlaceMergeDialog place={KOLOSSEUM} onClose={onClose} onMerged={onMerged} />);
  await act(async () => {});
  return { onMerged, onClose };
}

const confirmButton = (): HTMLElement => screen.getByRole("button", { name: "Zusammenführen" });

async function pickColosseum(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Colosseum/ }));
  await act(async () => {}); // the counts arrive
}

describe("placeMergeModel", () => {
  it("asks only about the groups that differ, and sends 'target' for the rest", () => {
    expect(openGroups(KOLOSSEUM, COLOSSEUM, {})).toEqual(["name", "position", "address"]);
    expect(mergeFields(KOLOSSEUM, COLOSSEUM, { name: "source" })).toBeNull();
    expect(
      mergeFields(KOLOSSEUM, COLOSSEUM, { name: "target", position: "source", address: "source" })
    ).toEqual({
      name: "target",
      localName: "target",
      category: "target",
      position: "source",
      address: "source",
      notes: "target",
    });
  });

  it("keeps both notes only when asked to", () => {
    const a = { ...KOLOSSEUM, notes: "Abends" } as Place;
    const b = { ...KOLOSSEUM, id: "b", notes: "Tickets" } as Place;
    expect(mergeFields(a, b, { notes: "both" })?.notes).toBe("both");
  });
});

describe("PlaceMergeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPlaces.mockResolvedValue([FAR, KOLOSSEUM, COLOSSEUM]);
    getPlaceRelations.mockResolvedValue(RELATIONS);
    mergePlace.mockResolvedValue(KOLOSSEUM);
  });

  it("offers the user's other places, nearest first — and never picks one itself", async () => {
    await openDialog();
    const options = screen
      .getAllByRole("listitem")
      .map((li) => within(li).getByRole("button").textContent ?? "");
    expect(options[0]).toContain("Colosseum");
    expect(options[1]).toContain("Brandenburger Tor");
    expect(options.join(" ")).not.toContain("Kolosseum");
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("den doppelten Ort wählen");
    expect(mergePlace).not.toHaveBeenCalled();
  });

  it("shows both side by side, asks only where they differ, with nothing preselected", async () => {
    await openDialog();
    await pickColosseum();

    // Category, second name and note agree: shown once each, nothing asked.
    expect(screen.getAllByText(/bei beiden gleich/)).toHaveLength(3);
    expect(screen.queryByRole("group", { name: "Kategorie" })).not.toBeInTheDocument();
    const name = screen.getByRole("group", { name: "Name" });
    expect(within(name).getByRole("button", { name: /Kolosseum/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(within(name).getByRole("button", { name: /Colosseum/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByText(/liegen 183 m auseinander/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("Name");
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("Position");
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("Adresse");
  });

  it("says what moves and what is deleted before anything is confirmed", async () => {
    await openDialog();
    await pickColosseum();
    expect(getPlaceRelations).toHaveBeenCalledWith("s");
    const impact = screen.getByRole("region", { name: /Von „Colosseum“ zu „Kolosseum“/ });
    expect(impact).toHaveTextContent("2 Besuche");
    expect(impact).toHaveTextContent("3 Beleg-Fotos");
    expect(impact).toHaveTextContent("1 Dokument");
    expect(impact).toHaveTextContent("die Liste Antike");
    expect(impact).toHaveTextContent("Danach wird „Colosseum“ gelöscht.");
    expect(impact).toHaveTextContent("zählt als besucht");
  });

  // Review I1: the folded place's source reference survives as an alias.
  it("says the duplicate's source reference is kept", async () => {
    listPlaces.mockResolvedValue([{ ...COLOSSEUM, externalRef: "gmaps:123" }]);
    await openDialog();
    await pickColosseum();
    expect(screen.getByText(/bleibt als Zweitverweis erhalten/)).toBeInTheDocument();
  });

  it("says when the counts could not be had — and that everything moves anyway", async () => {
    getPlaceRelations.mockRejectedValue(new Error("503"));
    await openDialog();
    await pickColosseum();
    expect(screen.getByText(/ließ sich nicht zählen/)).toBeInTheDocument();
  });

  it("sends the explicit choices in one request and hands the kept place on", async () => {
    const { onMerged } = await openDialog();
    await pickColosseum();
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("group", { name: "Name" })).getByRole("button", { name: /Kolosseum/ })
    );
    await user.click(
      within(screen.getByRole("group", { name: "Position" })).getByRole("button", {
        name: /Der andere/,
      })
    );
    await user.click(
      within(screen.getByRole("group", { name: "Adresse" })).getByRole("button", {
        name: /Roma/,
      })
    );
    expect(confirmButton()).toBeEnabled();
    await user.click(confirmButton());

    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(KOLOSSEUM));
    expect(mergePlace).toHaveBeenCalledTimes(1);
    expect(mergePlace).toHaveBeenCalledWith("t", {
      sourceId: "s",
      fields: {
        name: "target",
        localName: "target",
        category: "target",
        position: "source",
        address: "source",
        notes: "target",
      },
    });
  });

  async function chooseAll(): Promise<void> {
    for (const group of ["Name", "Position", "Adresse"]) {
      fireEvent.click(within(screen.getByRole("group", { name: group })).getAllByRole("button")[0]);
    }
  }

  it("repeated taps merge once", async () => {
    let resolve: (p: Place) => void = () => {};
    mergePlace.mockReturnValue(new Promise<Place>((r) => (resolve = r)));
    await openDialog();
    await pickColosseum();
    await chooseAll();
    const button = confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve(KOLOSSEUM));
    expect(mergePlace).toHaveBeenCalledTimes(1);
  });

  it("a refusal keeps every choice, says nothing changed, and offers a retry when it may help", async () => {
    mergePlace
      .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
      .mockResolvedValueOnce(KOLOSSEUM);
    const { onMerged } = await openDialog();
    await pickColosseum();
    await chooseAll();
    fireEvent.click(confirmButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Der Server ist nicht erreichbar");
    expect(
      within(screen.getByRole("group", { name: "Name" })).getAllByRole("button")[0]
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    expect(mergePlace).toHaveBeenCalledTimes(2);
  });

  it("says why two checklist entries cannot be one place", async () => {
    mergePlace.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "x", code: "PLACE_MERGE_BOTH_CURATED" } },
    });
    await openDialog();
    await pickColosseum();
    await chooseAll();
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Einträge von Checklisten");
  });

  // Review I4: said when the duplicate is picked, before any choice is made.
  it("explains at pick time why two checklist entries stay apart, naming both lists", async () => {
    const petra = { ...KOLOSSEUM, name: "Petra", curatedItemId: "world-heritage:326" } as Place;
    const petra7 = {
      ...COLOSSEUM,
      name: "Petra (Neue 7)",
      curatedItemId: "world-wonders-new7:petra",
    } as Place;
    listPlaces.mockResolvedValue([petra7]);
    render(<PlaceMergeDialog place={petra} onClose={vi.fn()} onMerged={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Petra \(Neue 7\)/ }));
    await act(async () => {});

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Einträge zweier Checklisten");
    expect(notice).toHaveTextContent("UNESCO-Welterbe, Neue 7 Weltwunder");
    expect(screen.queryByRole("group", { name: "Name" })).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(within(notice).getByRole("button", { name: "Anderen Ort wählen" }));
    expect(screen.getByLabelText("Doppelten Ort wählen")).toBeInTheDocument();
    expect(mergePlace).not.toHaveBeenCalled();
  });

  it("asks before a started merge is dropped; an untouched one closes at once", async () => {
    const first = await openDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(first.onClose).toHaveBeenCalledTimes(1));
  });

  it("a picked duplicate is protected from Escape", async () => {
    const { onClose } = await openDialog();
    await pickColosseum();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Änderungen verwerfen?")).toBeInTheDocument();
  });
});
