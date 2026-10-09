/**
 * Recording a visit from anywhere the place is in view (forgejo#231), on the
 * shared form blocks (forgejo#245–#249). Rendered through the real German
 * resources, so what is asserted is what a reader sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setClockForTests } from "../../../shared/time";
import type { PlaceVisit } from "../../../types/place";

const createVisit = vi.fn();
const updateVisit = vi.fn();
const uploadVisitPhotos = vi.fn();
const getAllTrips = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  createVisit: (...a: unknown[]) => createVisit(...a),
  updateVisit: (...a: unknown[]) => updateVisit(...a),
  uploadVisitPhotos: (...a: unknown[]) => uploadVisitPhotos(...a),
  getVisitDateSuggestions: vi.fn(async () => []),
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import { VisitDialog } from "../VisitDialog";

const PLACE = { id: "p1", name: "Wartburg" };
const stored = { id: "v-new", placeId: "p1" } as unknown as PlaceVisit;
const network = { isAxiosError: true, message: "Network Error" };

async function renderDialog(
  props: Partial<Parameters<typeof VisitDialog>[0]> = {}
): Promise<{ onSaved: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> }> {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<VisitDialog place={PLACE} onClose={onClose} onSaved={onSaved} {...props} />);
  await act(async () => {}); // the trip list settles
  return { onSaved, onClose };
}

const save = (): HTMLElement => screen.getByRole("button", { name: "Speichern" });

describe("VisitDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 23:30 UTC: the user's "today" is asked in the profile zone (UTC when
    // none is confirmed, ADR 0002 Q1) — never the host's.
    setClockForTests("2026-10-09T23:30:00Z");
    createVisit.mockResolvedValue(stored);
    updateVisit.mockResolvedValue(stored);
    uploadVisitPhotos.mockResolvedValue([]);
    getAllTrips.mockResolvedValue([{ id: "t1", name: "Thüringen" }]);
  });
  afterEach(() => setClockForTests(null));

  it("records today in one tap — the day alone, filed by date", async () => {
    const { onSaved } = await renderDialog();
    expect(screen.getByRole("dialog", { name: "Besuch erfassen · Wartburg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Heute/ })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createVisit).toHaveBeenCalledWith("p1", { visitedAt: "2026-10-09", notes: null });
  });

  it("'Datum unbekannt' sends null — never a made-up day", async () => {
    await renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Datum unbekannt" }));
    expect(screen.getByText(/ohne Datum gespeichert/)).toBeInTheDocument();
    await userEvent.click(save());
    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("p1", expect.objectContaining({ visitedAt: null }))
    );
  });

  it("'Anderes Datum' needs a day, says so beside the button, and takes the cursor there", async () => {
    await renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Anderes Datum" }));
    expect(save()).toBeDisabled();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("Datum");

    await userEvent.click(screen.getByRole("button", { name: "Datum" }));
    const date = screen.getByLabelText(/^Datum/);
    expect(document.activeElement).toBe(date);
    expect(date).toHaveAttribute("aria-required", "true");

    fireEvent.change(date, { target: { value: "2025-06-01" } });
    fireEvent.change(screen.getByLabelText("Uhrzeit (optional)"), { target: { value: "14:30" } });
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          visitedAt: { local: "2025-06-01T14:30", placeRef: { kind: "place", id: "p1" } },
        })
      )
    );
  });

  it("sends trip and note when given", async () => {
    await renderDialog();
    await userEvent.selectOptions(screen.getByLabelText("Reise"), "t1");
    await userEvent.type(screen.getByLabelText("Notiz zum Besuch"), "Lutherstube");
    await userEvent.click(save());
    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("p1", {
        visitedAt: "2026-10-09",
        notes: "Lutherstube",
        tripId: "t1",
      })
    );
  });

  it("repeated taps while it saves record ONE visit", async () => {
    let resolve: (v: PlaceVisit) => void = () => {};
    createVisit.mockReturnValue(new Promise<PlaceVisit>((r) => (resolve = r)));
    await renderDialog();
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve(stored));
    expect(createVisit).toHaveBeenCalledTimes(1);
  });

  it("a failure keeps everything typed, says why in the dialog, and offers a retry", async () => {
    createVisit.mockRejectedValueOnce(network).mockResolvedValueOnce(stored);
    const { onSaved } = await renderDialog();
    await userEvent.type(screen.getByLabelText("Notiz zum Besuch"), "Lutherstube");
    await userEvent.click(save());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Der Server ist nicht erreichbar");
    expect(screen.getByLabelText("Notiz zum Besuch")).toHaveValue("Lutherstube");
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createVisit).toHaveBeenCalledTimes(2);
  });

  it("uploads a picked photo after the visit is stored", async () => {
    const { onSaved } = await renderDialog();
    const file = new File(["x"], "wartburg.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Fotos (optional)"), file);
    expect(screen.getByText("1 Foto ausgewählt")).toBeInTheDocument();
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(uploadVisitPhotos).toHaveBeenCalledWith("v-new", [file]);
  });

  it("a photo that fails costs not the visit: said as such, retried alone, or left out", async () => {
    uploadVisitPhotos.mockRejectedValueOnce(network).mockResolvedValueOnce([]);
    const { onSaved } = await renderDialog();
    await userEvent.upload(
      screen.getByLabelText("Fotos (optional)"),
      new File(["x"], "a.jpg", { type: "image/jpeg" })
    );
    await userEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Besuch gespeichert.");
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Fotos erneut hochladen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createVisit).toHaveBeenCalledTimes(1);
    expect(uploadVisitPhotos).toHaveBeenCalledTimes(2);
  });

  it("'Weiter ohne Fotos' hands the stored visit on without another upload", async () => {
    uploadVisitPhotos.mockRejectedValue(network);
    const { onSaved } = await renderDialog();
    await userEvent.upload(
      screen.getByLabelText("Fotos (optional)"),
      new File(["x"], "a.jpg", { type: "image/jpeg" })
    );
    await userEvent.click(save());
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Weiter ohne Fotos" }));
    expect(onSaved).toHaveBeenCalledWith(stored);
    expect(uploadVisitPhotos).toHaveBeenCalledTimes(1);
  });

  it("a day ahead says it does not count yet and offers no photos", async () => {
    await renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Anderes Datum" }));
    fireEvent.change(screen.getByLabelText(/^Datum/), { target: { value: "2026-12-24" } });
    expect(screen.getByText(/liegt in der Zukunft/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Fotos (optional)")).not.toBeInTheDocument();
  });

  it("asks before Escape drops a changed dialog, and closes an untouched one at once", async () => {
    const first = await renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(first.onClose).toHaveBeenCalledTimes(1);
  });

  it("a typed note is protected from Escape", async () => {
    const { onClose } = await renderDialog();
    await userEvent.type(screen.getByLabelText("Notiz zum Besuch"), "x");
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Änderungen verwerfen?")).toBeInTheDocument();
  });

  it("says when the trips could not be loaded and loads them again on request", async () => {
    getAllTrips.mockRejectedValueOnce(network).mockResolvedValueOnce([{ id: "t1", name: "X" }]);
    await renderDialog();
    expect(screen.getByText(/Reisen konnten nicht geladen werden/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "X" })).toBeInTheDocument());
  });

  it("an undated visit opens on 'Datum unbekannt' and an untouched edit closes quietly", async () => {
    const visit = {
      id: "v1",
      placeId: "p1",
      tripId: null,
      visitedAt: null,
      notes: null,
    } as unknown as PlaceVisit;
    const { onClose } = await renderDialog({ visit });
    expect(screen.getByRole("dialog", { name: "Besuch bearbeiten" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Datum unbekannt" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByLabelText("Fotos (optional)")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the date choices reach the touch minimum on a coarse pointer", async () => {
    await renderDialog();
    expect(screen.getByRole("button", { name: "Datum unbekannt" }).className).toContain(
      "pointer-coarse:min-h-(--ts-size-touch-min)"
    );
  });
});
