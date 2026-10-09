/**
 * The place form on the shared form blocks (forgejo#245–#249). Before: a
 * greyed-out "Speichern" that said nothing about an empty name, a position
 * sentence at the bottom right, every refusal a toast that vanished
 * (h-inventory §2), the list reload inside the save's own try (a failed reload
 * read as a failed save, and the next click created the place twice), and
 * Escape dropping a half-typed place without a word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Place } from "../../../types/place";

const createPlace = vi.fn();
const updatePlace = vi.fn();
const listPlaceLists = vi.fn();
const addPlaceToList = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createPlace: (...a: unknown[]) => createPlace(...a),
  updatePlace: (...a: unknown[]) => updatePlace(...a),
}));
vi.mock("../../../lib/api/placeLists", () => ({
  listPlaceLists: (...a: unknown[]) => listPlaceLists(...a),
  addPlaceToList: (...a: unknown[]) => addPlaceToList(...a),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));

// Stands in for LocationInput with the parts this form depends on: a pick, a
// validity report, and the ids the real component gives its fields.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
    onValidityChange,
    idPrefix,
    required,
  }: {
    onChange: (s: unknown) => void;
    onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
    idPrefix: string;
    required?: boolean;
  }) => (
    <div>
      <label htmlFor={`${idPrefix}-search`}>search</label>
      <input id={`${idPrefix}-search`} aria-required={required ? "true" : undefined} />
      <button type="button" onClick={() => onChange({ lat: 41.9, lon: 12.48 })}>
        mock-pick
      </button>
      <button type="button" onClick={() => onValidityChange?.(false, "lon")}>
        mock-bad-lon
      </button>
      <details>
        <summary>location:advanced</summary>
        <label htmlFor={`${idPrefix}-lon`}>location:field.lon</label>
        <input id={`${idPrefix}-lon`} />
      </details>
    </div>
  ),
}));

import { PlaceFormModal } from "../PlaceFormModal";

const stored = { id: "p-new", name: "Trevi" } as unknown as Place;
const nameField = (): HTMLElement => screen.getByRole("textbox", { name: /places:form\.name$/ });
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "common:buttons.save" });
const hint = (): HTMLElement | null => screen.queryByTestId("save-blocked-hint");

const list = (id: string, name: string) => ({
  id,
  name,
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
});

async function fillValid(): Promise<void> {
  await userEvent.click(screen.getByText("mock-pick"));
  await userEvent.type(nameField(), "Trevi");
}

describe("PlaceFormModal — the shared form blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPlace.mockResolvedValue(stored);
    listPlaceLists.mockResolvedValue([]);
    addPlaceToList.mockResolvedValue({});
  });

  it("marks name and position as required and explains the mark", async () => {
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => {}); // the list picker's load settles
    expect(nameField()).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("search")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("says why save is greyed out — name AND position — and the hint updates live", async () => {
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(saveButton()).toBeDisabled();
    expect(hint()).toHaveTextContent(
      "common:form.saveBlocked places:form.name and places:form.missing.position"
    );
    expect(saveButton()).toHaveAccessibleDescription(
      "common:form.saveBlocked places:form.name and places:form.missing.position"
    );

    // The hint item takes the cursor to the field.
    await userEvent.click(screen.getByRole("button", { name: "places:form.missing.position" }));
    expect(document.activeElement).toBe(screen.getByLabelText("search"));

    await userEvent.click(screen.getByText("mock-pick"));
    expect(hint()).toHaveTextContent("common:form.saveBlocked places:form.name");
    await userEvent.type(nameField(), "Trevi");
    expect(hint()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("names a refused coordinate and takes the user to it, unfolding its section", async () => {
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillValid();
    await userEvent.click(screen.getByText("mock-bad-lon"));
    expect(saveButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "places:form.missing.coordinates" }));
    expect(document.activeElement).toBe(screen.getByLabelText("location:field.lon"));
    expect(screen.getByText("location:advanced").closest("details")?.open).toBe(true);
  });

  it("asks before Escape or Cancel drops a changed form, and closes an unchanged one at once", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PlaceFormModal place={null} onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseChanged = vi.fn();
    render(<PlaceFormModal place={null} onClose={onCloseChanged} onSaved={vi.fn()} />);
    await userEvent.type(nameField(), "Trevi");
    await userEvent.keyboard("{Escape}");
    expect(onCloseChanged).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(onCloseChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onCloseChanged).toHaveBeenCalledTimes(1);
  });

  it("an untouched EDIT closes without a question", async () => {
    const onClose = vi.fn();
    const place = {
      id: "p1",
      name: "Trevi",
      localName: null,
      category: "landmark",
      lat: 41.9,
      lon: 12.48,
      address: null,
      city: "Rom",
      country: null,
      notes: null,
      visited: true,
      externalRef: null,
      visits: [],
    } as unknown as Place;
    render(<PlaceFormModal place={place} onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft on a failed save, says why in the form, and offers a retry", async () => {
    // A refusal the server answered (nothing stored), so a create may retry.
    createPlace
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 503, data: { code: "DB_UNAVAILABLE" } },
      })
      .mockResolvedValueOnce(stored);
    const onSaved = vi.fn();
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={onSaved} />);
    await fillValid();
    await userEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.dbUnavailable");
    expect(nameField()).toHaveValue("Trevi");
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(banner));

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createPlace).toHaveBeenCalledTimes(2);
  });

  // Bus review, Minor 2 (integration wiring): the place may be stored.
  it("offers no retry after a create whose answer was lost, and offers a reload instead", async () => {
    createPlace.mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" });
    const onReload = vi.fn();
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    await fillValid();
    await userEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("common:saveErrors.outcomeUnknown");
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
    expect(nameField()).toHaveValue("Trevi");
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.reloadList" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(createPlace).toHaveBeenCalledTimes(1);
  });

  it("a refusal that a retry would not cure has no retry, and leaves at the next edit", async () => {
    createPlace.mockRejectedValueOnce(new Error("500"));
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillValid();
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("places:form.saveFailed");
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).not.toBeInTheDocument();

    await userEvent.type(nameField(), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("two quick presses send one request", async () => {
    let resolve: (p: Place) => void = () => {};
    createPlace.mockReturnValue(new Promise<Place>((r) => (resolve = r)));
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillValid();
    const button = saveButton();
    await userEvent.click(button);
    await userEvent.click(button);
    resolve(stored);
    await waitFor(() => expect(createPlace).toHaveBeenCalledTimes(1));
  });

  it("does not create twice when the page's reload after a save fails", async () => {
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={onSaved} />);
    await fillValid();
    await userEvent.click(saveButton());

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common:buttons.save" })).not.toBeInTheDocument();
    expect(screen.queryByText("places:form.saveFailed")).not.toBeInTheDocument();
    expect(createPlace).toHaveBeenCalledTimes(1);
  });

  it("names the lists that refused the place, re-asks exactly those, then continues", async () => {
    listPlaceLists.mockResolvedValue([list("l1", "Maccis"), list("l2", "Rom")]);
    addPlaceToList
      .mockResolvedValueOnce({}) // l1 takes it
      .mockRejectedValueOnce(new Error("503")) // l2 refuses
      .mockResolvedValueOnce({}); // l2 on the retry
    const onSaved = vi.fn();
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole("button", { name: "Maccis" }));
    await userEvent.click(screen.getByRole("button", { name: "Rom" }));
    await fillValid();
    await userEvent.click(saveButton());

    // Partly done, said as such — not a failure, not a plain success.
    expect(await screen.findByRole("alert")).toHaveTextContent("places:form.listPartial");
    expect(onSaved).not.toHaveBeenCalled();
    expect(createPlace).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "places:form.listRetry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(addPlaceToList.mock.calls.map((c) => c[0])).toEqual(["l1", "l2", "l2"]);
    expect(createPlace).toHaveBeenCalledTimes(1);
  });

  it("'Weiter' leaves the refused lists alone and hands the stored place on", async () => {
    listPlaceLists.mockResolvedValue([list("l1", "Maccis")]);
    addPlaceToList.mockRejectedValue(new Error("409"));
    const onSaved = vi.fn();
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole("button", { name: "Maccis" }));
    await fillValid();
    await userEvent.click(saveButton());
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "places:form.listContinue" }));
    expect(onSaved).toHaveBeenCalledWith(stored);
    expect(addPlaceToList).toHaveBeenCalledTimes(1);
  });

  it("toggle chips say whether they are on, and every control has a visible label", async () => {
    render(<PlaceFormModal place={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => {}); // the list picker's load settles
    expect(screen.getByRole("button", { name: "places:form.onWishlist" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "places:form.wasHere" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    for (const key of ["localName", "category", "address", "city", "country", "notes"]) {
      expect(screen.getByLabelText(`places:form.${key}`)).toBeInTheDocument();
    }
  });
});
