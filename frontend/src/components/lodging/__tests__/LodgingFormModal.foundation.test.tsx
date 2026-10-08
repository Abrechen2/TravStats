/**
 * The lodging house form is the reference application of the shared form
 * blocks (forgejo#245–#248). Before: a greyed-out "Speichern" that said
 * nothing, a coordinate complaint hidden in a folded section, a red line with
 * no role, one generic sentence for every refusal, and Escape dropping a
 * half-typed lodging without a word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingFormModal } from "../LodgingFormModal";
import { createLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => ({
    amenities: [],
    roomAmenities: [],
    roomNumbers: [],
    roomCategories: [],
    boards: [],
  }),
}));
vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  updateLodging: vi.fn(),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../ChainPicker", () => ({ ChainPicker: () => null }));
vi.mock("../LodgingOsmNearby", () => ({ LodgingOsmNearby: () => null }));

// Stands in for LocationInput with exactly the part this form depends on: a
// validity report, and a latitude field inside a FOLDED section, under the id
// the real component gives it.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onValidityChange,
    idPrefix,
  }: {
    onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
    idPrefix: string;
  }) => (
    <div>
      <button type="button" onClick={() => onValidityChange?.(false)}>
        mock-type-bad-coordinates
      </button>
      <button type="button" onClick={() => onValidityChange?.(false, "lon")}>
        mock-type-bad-longitude
      </button>
      <button type="button" onClick={() => onValidityChange?.(true)}>
        mock-fix-coordinates
      </button>
      <details>
        <summary>location:advanced</summary>
        <label htmlFor={`${idPrefix}-lat`}>location:field.lat</label>
        <input id={`${idPrefix}-lat`} />
        <label htmlFor={`${idPrefix}-lon`}>location:field.lon</label>
        <input id={`${idPrefix}-lon`} />
      </details>
    </div>
  ),
}));

const stored: Lodging = {
  id: "new-lodging",
  userId: "user-1",
  type: "hotel",
  name: "Hotel Adlon",
  chainId: null,
  chain: null,
  address: null,
  city: null,
  country: null,
  isoCountryCode: null,
  lat: null,
  lon: null,
  stars: null,
  amenities: [],
  visited: true,
  notes: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  stays: [],
  overallRating: null,
  stayCount: 0,
  nights: 0,
  totalSpendBase: 0,
  totalSpendBaseByCurrency: {},
};

const nameField = (): HTMLElement => screen.getByRole("textbox", { name: /lodging:field\.name/ });
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "common:buttons.save" });
const hint = (): HTMLElement | null => screen.queryByTestId("save-blocked-hint");

describe("LodgingFormModal — the shared form blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the name as required and explains the mark", () => {
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(nameField()).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("says why save is greyed out, and the hint clears as the gaps are filled", async () => {
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(saveButton()).toBeDisabled();
    expect(hint()).toHaveTextContent("common:form.saveBlocked lodging:field.name");
    expect(saveButton()).toHaveAccessibleDescription("common:form.saveBlocked lodging:field.name");

    // The coordinate problem is named in the hint, without opening the
    // folded section it is reported in.
    await userEvent.click(screen.getByText("mock-type-bad-coordinates"));
    expect(hint()).toHaveTextContent(
      "common:form.saveBlocked lodging:field.name and lodging:form.missing.coordinates"
    );

    await userEvent.type(nameField(), "Hotel Adlon");
    expect(hint()).toHaveTextContent("common:form.saveBlocked lodging:form.missing.coordinates");
    expect(saveButton()).toBeDisabled();

    // …and the hint takes the user there, unfolding the section.
    await userEvent.click(screen.getByRole("button", { name: "lodging:form.missing.coordinates" }));
    expect(document.activeElement).toBe(screen.getByLabelText("location:field.lat"));
    expect(screen.getByText("location:advanced").closest("details")?.open).toBe(true);

    await userEvent.click(screen.getByText("mock-fix-coordinates"));
    expect(hint()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("asks before Escape drops a changed form, and closes an unchanged one at once", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <LodgingFormModal mode="create" onClose={onClose} onSaved={vi.fn()} />
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseChanged = vi.fn();
    render(<LodgingFormModal mode="create" onClose={onCloseChanged} onSaved={vi.fn()} />);
    await userEvent.type(nameField(), "Hotel Adlon");
    await userEvent.keyboard("{Escape}");
    expect(onCloseChanged).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();

    // The form's own Cancel goes through the same question.
    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(onCloseChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onCloseChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft on a failed save, says why in an announced banner, and offers a retry", async () => {
    vi.mocked(createLodging)
      .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
      .mockResolvedValueOnce(stored);
    const onSaved = vi.fn();
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(nameField(), "Hotel Adlon");
    await userEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.network");
    expect(nameField()).toHaveValue("Hotel Adlon");
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(banner));

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createLodging).toHaveBeenCalledTimes(2);
  });

  it("drops the banner at the next edit", async () => {
    vi.mocked(createLodging).mockRejectedValueOnce(new Error("500"));
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(nameField(), "Hotel Adlon");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("lodging:form.saveError");

    await userEvent.type(nameField(), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts a field the server would refuse at the field, and goes there", async () => {
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(nameField(), "Hotel Adlon");
    fireEvent.change(screen.getByLabelText("lodging:field.stars"), { target: { value: "7" } });
    await userEvent.click(saveButton());

    const stars = screen.getByLabelText("lodging:field.stars");
    expect(stars).toHaveAttribute("aria-invalid", "true");
    expect(stars).toHaveAccessibleDescription("lodging:form.errors.stars");
    await waitFor(() => expect(document.activeElement).toBe(stars));
    expect(createLodging).not.toHaveBeenCalled();
  });

  it("does not create twice when the list reload after a save fails", async () => {
    vi.mocked(createLodging).mockResolvedValue(stored);
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(nameField(), "Hotel Adlon");
    await userEvent.click(saveButton());

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common:buttons.save" })).not.toBeInTheDocument();
    expect(screen.queryByText("lodging:form.saveError")).not.toBeInTheDocument();
    expect(createLodging).toHaveBeenCalledTimes(1);
  });

  // Review fix round 1: the hint jumps to the value that is actually wrong.
  it("takes the user to the longitude when the longitude is the wrong one", async () => {
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByText("mock-type-bad-longitude"));
    await userEvent.click(screen.getByRole("button", { name: "lodging:form.missing.coordinates" }));
    expect(document.activeElement).toBe(screen.getByLabelText("location:field.lon"));
  });

  // An out-of-range number the user typed is input too — Escape must not drop it.
  it("counts a rejected coordinate as a change worth asking about", async () => {
    const onClose = vi.fn();
    render(<LodgingFormModal mode="create" onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByText("mock-type-bad-coordinates"));
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();
  });

  it("names the view, not the list, when the caller says so", async () => {
    vi.mocked(createLodging).mockResolvedValue(stored);
    render(
      <LodgingFormModal
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn().mockRejectedValue(new Error("reload failed"))}
        afterSaveFailedKey="common:form.savedButViewRefreshFailed"
      />
    );
    await userEvent.type(nameField(), "Hotel Adlon");
    await userEvent.click(saveButton());
    expect(await screen.findByText("common:form.savedButViewRefreshFailed")).toBeInTheDocument();
  });
});
