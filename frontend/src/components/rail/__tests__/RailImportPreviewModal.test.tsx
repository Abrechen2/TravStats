import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.name ? `${k}:${String(o.name)}` : o?.count !== undefined ? `${k}/${String(o.count)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
// The station field stands in as one button that picks a position.
vi.mock("../StationPicker", () => ({
  StationPicker: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (s: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          name: "Neufahrn (b Freising)",
          lat: 48.32,
          lon: 11.66,
          country: "DE",
          code: "8020489",
          stationId: 99,
        })
      }
    >
      pick {label}
    </button>
  ),
}));
const create = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: { create: (...a: unknown[]) => create(...a) },
}));

import { RailImportPreviewModal } from "../RailImportPreviewModal";
import { booking, leg, station } from "./railImportFixture";

const saveButton = (): HTMLElement => screen.getByRole("button", { name: /rail:import.save/ });

describe("RailImportPreviewModal", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("saves the ticked legs in order, bound into one booking, the total on the first", async () => {
    create
      .mockResolvedValueOnce({ journey: { id: "new-1" }, geometry: null })
      .mockResolvedValueOnce({ journey: { id: "new-2" }, geometry: null });
    const onSaved = vi.fn();
    render(<RailImportPreviewModal booking={booking()} onCancel={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByLabelText("rail:form.bookingReference")).toHaveValue("210987654321");
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(create.mock.calls[0][0]).toMatchObject({ price: 1084.5, trainNumber: "7" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("connectsFrom");
    expect(create.mock.calls[1][0]).toMatchObject({
      price: null,
      trainNumber: "1507",
      connectsFrom: "new-1",
    });
  });

  // forgejo#161: the operator the ticket names is shown before saving and
  // travels with every leg it writes — it was neither.
  it("shows the operator and writes it with the leg", async () => {
    create.mockResolvedValue({ journey: { id: "new-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailImportPreviewModal
        booking={{ ...booking(), operator: "Deutsche Bahn" }}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByLabelText("rail:form.operator")).toHaveValue("Deutsche Bahn");
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ operator: "Deutsche Bahn" });
  });

  it("asks for an unresolved station and saves nothing until it is picked", async () => {
    create.mockResolvedValue({ journey: { id: "new-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailImportPreviewModal
        booking={booking({
          legs: [leg({ departureStation: station("Neufahrn(b Freising)", false) })],
        })}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByText("rail:import.unresolved:Neufahrn(b Freising)")).toBeInTheDocument();
    expect(screen.getByTestId("rail-import-blocked")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      departureStation: { stationId: 99, lat: 48.32 },
    });
  });

  it("leaves a logged ride unticked and continues the connection from it", async () => {
    create.mockResolvedValue({ journey: { id: "new-2" }, geometry: null });
    const onSaved = vi.fn();
    const b = booking();
    render(
      <RailImportPreviewModal
        booking={{ ...b, legs: [{ ...b.legs[0], duplicateOf: "old-1" }, b.legs[1]] }}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByText("rail:import.duplicate")).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(create).toHaveBeenCalledTimes(1);
    // The total was probably recorded with the logged leg; it is not written twice.
    expect(create.mock.calls[0][0]).toMatchObject({ connectsFrom: "old-1", price: null });
  });

  // forgejo#161: a fact the document did not carry is marked as such, can be
  // filled in before saving, and is never made up.
  it("marks unread booking facts, lets them be filled in, and writes what was confirmed", async () => {
    create.mockResolvedValue({ journey: { id: "new-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailImportPreviewModal
        booking={booking({
          operator: null,
          bookingReference: null,
          travelClass: null,
          price: null,
          currency: null,
          legs: [leg()],
        })}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByTestId("rail-import-incomplete")).toBeInTheDocument();
    for (const f of ["operator", "bookingReference", "travelClass", "price"]) {
      expect(screen.getByTestId(`rail-import-unread-${f}`)).toBeInTheDocument();
    }

    fireEvent.change(screen.getByLabelText("rail:form.operator"), {
      target: { value: "Deutsche Bahn" },
    });
    fireEvent.change(screen.getByLabelText("rail:form.bookingReference"), {
      target: { value: "QARAIL20261002" },
    });
    fireEvent.change(screen.getByLabelText("rail:form.class"), { target: { value: "second" } });
    fireEvent.change(screen.getByLabelText("rail:import.total"), { target: { value: "59,90" } });
    // A total without its currency is not saved as some currency.
    expect(screen.getByTestId("rail-import-problem-currency")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("rail:form.currency"), { target: { value: "eur" } });
    expect(screen.getByTestId("rail-import-edited-operator")).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      operator: "Deutsche Bahn",
      bookingReference: "QARAIL20261002",
      travelClass: "second",
      price: 59.9,
      currency: "EUR",
    });
  });

  it("corrects a misread total and leaves an emptied field empty", async () => {
    create.mockResolvedValue({ journey: { id: "new-1" }, geometry: null });
    const onSaved = vi.fn();
    render(
      <RailImportPreviewModal
        booking={booking({ operator: "Deutsche Bahn", legs: [leg()] })}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.queryByTestId("rail-import-incomplete")).not.toBeInTheDocument();
    const total = screen.getByLabelText("rail:import.total");
    fireEvent.change(total, { target: { value: "12 Euro" } });
    expect(screen.getByTestId("rail-import-problem-price")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(total, { target: { value: "108,45" } });
    fireEvent.change(screen.getByLabelText("rail:form.class"), { target: { value: "" } });

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ price: 108.45, travelClass: null });
  });

  it("says why a refused leg was refused, stays open, and retries only that leg", async () => {
    create
      .mockResolvedValueOnce({ journey: { id: "new-1" }, geometry: null })
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { code: "RAIL_LOCAL_TIME_NONEXISTENT", field: "departureLocal" },
        },
      })
      .mockResolvedValueOnce({ journey: { id: "new-2" }, geometry: null });
    const onSaved = vi.fn();
    render(<RailImportPreviewModal booking={booking()} onCancel={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(saveButton());
    expect(await screen.findByText("rail:form.errors.nonexistentTime")).toBeInTheDocument();
    expect(screen.getByText("rail:import.legSaved")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0]).toMatchObject({ trainNumber: "1507", connectsFrom: "new-1" });
  });
});
