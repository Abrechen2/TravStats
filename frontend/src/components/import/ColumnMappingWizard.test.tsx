import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnMappingWizard } from "./ColumnMappingWizard";

const FULL_HEADERS = [
  "date",
  "fromIata",
  "toIata",
  "depTimeLocal",
  "arrTimeLocal",
  "flightNumber",
  "airline",
  "aircraft",
  "registration",
  "seatNumber",
];

const FULL_SAMPLES: Record<string, string> = {
  date: "2024-06-15",
  fromIata: "MUC",
  toIata: "FCO",
  depTimeLocal: "09:30:00",
  arrTimeLocal: "11:15:00",
  flightNumber: "LH1844",
  airline: "Lufthansa",
  aircraft: "A320",
  registration: "D-AIPA",
  seatNumber: "14C",
};

describe("ColumnMappingWizard", () => {
  it("auto-maps headers that exactly match TravStats field keys", () => {
    const onSubmit = vi.fn();
    render(
      <ColumnMappingWizard
        csvHeaders={FULL_HEADERS}
        csvSamples={FULL_SAMPLES}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );
    // All required + optional are exact matches → Continue should be enabled
    const continueBtn = screen.getByRole("button", {
      name: /settings:import\.preview\.wizard\.continue/i,
    });
    expect(continueBtn).not.toBeDisabled();
    fireEvent.click(continueBtn);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "date",
        fromIata: "fromIata",
        toIata: "toIata",
      })
    );
  });

  it("auto-maps headers via the alias dictionary (case-insensitive)", () => {
    const onSubmit = vi.fn();
    render(
      <ColumnMappingWizard
        csvHeaders={["Flight Date", "Origin", "Destination", "Tail"]}
        csvSamples={{
          "Flight Date": "2024-06-15",
          Origin: "MUC",
          Destination: "FCO",
          Tail: "D-AIPA",
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings:import\.preview\.wizard\.continue/i,
      })
    );
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "Flight Date",
        fromIata: "Origin",
        toIata: "Destination",
        registration: "Tail",
      })
    );
  });

  it("blocks submission when a required field is unmapped", () => {
    render(
      <ColumnMappingWizard
        csvHeaders={["something_else"]}
        csvSamples={{ something_else: "foo" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const continueBtn = screen.getByRole("button", {
      name: /settings:import\.preview\.wizard\.continue/i,
    });
    expect(continueBtn).toBeDisabled();
    expect(
      screen.getByText(/settings:import\.preview\.wizard\.missingFields/i)
    ).toBeInTheDocument();
  });

  it("flags collisions when one CSV header is mapped to two TravStats fields", () => {
    render(
      <ColumnMappingWizard
        csvHeaders={["date", "fromIata", "toIata"]}
        csvSamples={{ date: "2024-06-15", fromIata: "MUC", toIata: "FCO" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Re-point fromIata to the same header `toIata` is using → collision
    const fromSelect = screen.getByRole("combobox", {
      name: /fields\.fromIata/i,
    });
    fireEvent.change(fromSelect, { target: { value: "toIata" } });
    expect(
      screen.getByText(/settings:import\.preview\.wizard\.duplicateMappingHint/i)
    ).toBeInTheDocument();
    const continueBtn = screen.getByRole("button", {
      name: /settings:import\.preview\.wizard\.continue/i,
    });
    expect(continueBtn).toBeDisabled();
  });

  it("renders the row-1 sample value next to selected dropdowns", () => {
    render(
      <ColumnMappingWizard
        csvHeaders={["date"]}
        csvSamples={{ date: "2024-06-15" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Sample value is shown both inline next to the selected dropdown and
    // inside the option label — at least one occurrence is enough.
    const samples = screen.getAllByText(/2024-06-15/);
    expect(samples.length).toBeGreaterThan(0);
  });

  it("calls onCancel when the close button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ColumnMappingWizard csvHeaders={[]} csvSamples={{}} onSubmit={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings:import\.preview\.wizard\.cancel/i,
      })
    );
    expect(onCancel).toHaveBeenCalled();
  });
});
