/**
 * Repairing a missing location in place (forgejo#228): the address searched
 * again or a point set on the map, the result shown before it is taken, a
 * failure said as one with a retry, and only the two coordinates written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingLocationRepair, repairSearchText } from "../LodgingLocationRepair";
import { updateLodging } from "../../../lib/api/lodging";
import { searchPlaces } from "../../../lib/api/geo";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({ updateLodging: vi.fn() }));
vi.mock("../../../lib/api/geo", () => ({ searchPlaces: vi.fn() }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
// MapLibre needs WebGL; the dialog only has to hand the preview a position.
vi.mock("../../location/LocationMiniMap", () => ({
  LocationMiniMap: ({ value }: { value: { lat: number; lon: number } | null }) => (
    <div data-testid="preview-map">{value ? `${value.lat},${value.lon}` : "none"}</div>
  ),
}));
// The map picker is its own, tested component: here it confirms a fixed point.
vi.mock("../../location/LocationMapModal", () => ({
  LocationMapModal: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (s: { lat: number; lon: number; address?: string; city?: string }) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onConfirm({ lat: 52.5163, lon: 13.3777, address: "Unter den Linden 77", city: "Berlin" })
        }
      >
        stub-confirm-map-point
      </button>
    ) : null,
}));

const house = {
  id: "lodging-1",
  name: "Hotel Adlon",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "DE",
  lat: null,
  lon: null,
  stars: 5,
  notes: "Lobby bar",
  stays: [],
} as unknown as Lodging;

const updated = { ...house, lat: 52.5163, lon: 13.3777 } as Lodging;
const hit = {
  name: "Hotel Adlon Kempinski",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "Deutschland",
  lat: 52.5163,
  lon: 13.3777,
};
const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

async function renderRepair(onSaved = vi.fn(), onClose = vi.fn()): Promise<void> {
  await act(async () => {
    render(<LodgingLocationRepair lodging={house} onClose={onClose} onSaved={onSaved} />);
  });
}

const search = (): Promise<void> => userEvent.click(screen.getByTestId("repair-search"));
const save = (): HTMLElement => screen.getByTestId("repair-save");

describe("repairSearchText", () => {
  it("starts from where the house says it is, and from its name only as a last resort", () => {
    expect(repairSearchText(house)).toBe("Unter den Linden 77, Berlin, DE");
    expect(
      repairSearchText({ name: "Hotel St. Martin", address: null, city: " ", country: null })
    ).toBe("Hotel St. Martin");
  });
});

describe("LodgingLocationRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchPlaces).mockResolvedValue({ results: [hit], degraded: false });
    vi.mocked(updateLodging).mockResolvedValue(updated);
  });

  it("searches the address again, shows the hit, and writes nothing until it is taken", async () => {
    await renderRepair();
    expect(screen.getByLabelText("lodging:repair.queryLabel")).toHaveValue(
      "Unter den Linden 77, Berlin, DE"
    );
    // Nothing to take yet, and the dialog says what is missing.
    expect(save()).toBeDisabled();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("lodging:repair.missing");

    await search();
    const choice = await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ });
    await userEvent.click(choice);

    // The result is shown - in words and on the map - before it is taken.
    const preview = screen.getByTestId("repair-preview");
    expect(preview).toHaveTextContent("Hotel Adlon Kempinski");
    expect(preview).toHaveTextContent("52.51630, 13.37770");
    expect(within(preview).getByTestId("preview-map")).toHaveTextContent("52.5163,13.3777");
    expect(updateLodging).not.toHaveBeenCalled();
    expect(save()).toBeEnabled();
  });

  it("takes the result by writing exactly the two coordinates - not the whole house", async () => {
    const onSaved = vi.fn();
    await renderRepair(onSaved);
    await search();
    await userEvent.click(await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ }));
    await userEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(updateLodging).toHaveBeenCalledTimes(1);
    const [id, payload] = vi.mocked(updateLodging).mock.calls[0];
    expect(id).toBe("lodging-1");
    // The name, stars, notes and address are not in the request, so they cannot change.
    expect(payload).toEqual({ lat: 52.5163, lon: 13.3777 });
  });

  it("sets a point on the map instead, and shows it before taking it", async () => {
    const onSaved = vi.fn();
    await renderRepair(onSaved);
    await userEvent.click(screen.getByTestId("repair-map"));
    await userEvent.click(screen.getByText("stub-confirm-map-point"));

    expect(screen.getByTestId("repair-preview")).toHaveTextContent("Unter den Linden 77, Berlin");
    expect(updateLodging).not.toHaveBeenCalled();
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(updateLodging).mock.calls[0][1]).toEqual({ lat: 52.5163, lon: 13.3777 });
  });

  it("says a failed search is a failure, not 'nothing found', and retries it", async () => {
    vi.mocked(searchPlaces).mockResolvedValueOnce({ results: [], degraded: true });
    await renderRepair();
    await search();

    expect(await screen.findByText("lodging:repair.searchFailed")).toBeInTheDocument();
    expect(screen.queryByText("lodging:repair.noResults")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ })).toBeInTheDocument();
    expect(searchPlaces).toHaveBeenCalledTimes(2);
  });

  it("a search that throws is a failure too", async () => {
    vi.mocked(searchPlaces).mockRejectedValueOnce(networkError);
    await renderRepair();
    await search();
    expect(await screen.findByText("lodging:repair.searchFailed")).toBeInTheDocument();
  });

  it("an empty answer is said as such and points at the map", async () => {
    vi.mocked(searchPlaces).mockResolvedValueOnce({ results: [], degraded: false });
    await renderRepair();
    await search();
    expect(await screen.findByText("lodging:repair.noResults")).toBeInTheDocument();
    expect(screen.queryByText("lodging:repair.searchFailed")).toBeNull();
  });

  it("keeps the choice when the save fails, offers a retry, and sends the retry once", async () => {
    vi.mocked(updateLodging).mockRejectedValueOnce(networkError).mockResolvedValueOnce(updated);
    const onSaved = vi.fn();
    await renderRepair(onSaved);
    await search();
    await userEvent.click(await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ }));
    await userEvent.click(save());

    expect(await screen.findByText("common:saveErrors.network")).toBeInTheDocument();
    expect(screen.getByTestId("repair-preview")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(updateLodging).toHaveBeenCalledTimes(2);
  });

  it("saved, but the page could not refresh: says so and cannot be sent twice", async () => {
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));
    await renderRepair(onSaved);
    await search();
    await userEvent.click(await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ }));
    await userEvent.click(save());

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(updateLodging).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("repair-save")).toBeNull();
  });

  it("asks before discarding a chosen point, and closes at once when nothing was chosen", async () => {
    const onClose = vi.fn();
    await renderRepair(vi.fn(), onClose);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding once a place is chosen", async () => {
    const onClose = vi.fn();
    await renderRepair(vi.fn(), onClose);
    await search();
    await userEvent.click(await screen.findByRole("radio", { name: /Hotel Adlon Kempinski/ }));

    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("discard-question")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
