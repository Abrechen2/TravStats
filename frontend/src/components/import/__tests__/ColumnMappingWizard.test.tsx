import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ColumnMappingWizard, autoMapHeaders, type MappingFieldSpec } from "../ColumnMappingWizard";

// Mirrors the flight field spec built by `useFlightMappingFields` in
// GenericCsvImportTile.tsx — same keys, aliases and required flags. Labels
// are set to the literal i18n keys because the global test mock (see
// `src/__tests__/setup.ts`) makes `t(key)` return `key` unchanged, so this
// is exactly what the real component renders under test.
type FlightField =
  | "date"
  | "fromIata"
  | "toIata"
  | "depTimeLocal"
  | "arrTimeLocal"
  | "flightNumber"
  | "airline"
  | "aircraft"
  | "registration"
  | "seatNumber"
  | "notes";

const FLIGHT_MAPPING_FIELDS: MappingFieldSpec<FlightField>[] = [
  {
    key: "date",
    required: true,
    aliases: ["date", "flightdate", "datum", "depdate", "departuredate"],
    label: "settings:import.preview.wizard.fields.date",
  },
  {
    key: "fromIata",
    required: true,
    aliases: [
      "fromiata",
      "from",
      "origin",
      "originiata",
      "departure",
      "dep",
      "depiata",
      "departureiata",
      "von",
    ],
    label: "settings:import.preview.wizard.fields.fromIata",
  },
  {
    key: "toIata",
    required: true,
    aliases: [
      "toiata",
      "to",
      "destination",
      "destinationiata",
      "arrival",
      "arr",
      "arriata",
      "arrivaliata",
      "dest",
      "nach",
    ],
    label: "settings:import.preview.wizard.fields.toIata",
  },
  {
    key: "depTimeLocal",
    aliases: ["deptimelocal", "deptime", "departuretime", "dptlocal", "dpt", "abflugzeit"],
    label: "settings:import.preview.wizard.fields.depTimeLocal",
  },
  {
    key: "arrTimeLocal",
    aliases: ["arrtimelocal", "arrtime", "arrivaltime", "arrlocal", "ankunftszeit"],
    label: "settings:import.preview.wizard.fields.arrTimeLocal",
  },
  {
    key: "flightNumber",
    aliases: ["flightnumber", "flightno", "flight", "flightid", "flugnummer"],
    label: "settings:import.preview.wizard.fields.flightNumber",
  },
  {
    key: "airline",
    aliases: ["airline", "carrier", "fluggesellschaft"],
    label: "settings:import.preview.wizard.fields.airline",
  },
  {
    key: "aircraft",
    aliases: ["aircraft", "ac", "plane", "type", "flugzeug", "flugzeugtyp"],
    label: "settings:import.preview.wizard.fields.aircraft",
  },
  {
    key: "registration",
    aliases: ["registration", "reg", "tail", "tailnumber", "kennzeichen"],
    label: "settings:import.preview.wizard.fields.registration",
  },
  {
    key: "seatNumber",
    aliases: ["seatnumber", "seat", "seatno", "sitzplatz", "sitzplatznummer"],
    label: "settings:import.preview.wizard.fields.seatNumber",
  },
  {
    key: "notes",
    aliases: ["notes", "note", "remarks", "remark", "comment", "comments", "notiz", "notizen"],
    label: "settings:import.preview.wizard.fields.notes",
  },
];

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
        fields={FLIGHT_MAPPING_FIELDS}
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
        fields={FLIGHT_MAPPING_FIELDS}
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
        fields={FLIGHT_MAPPING_FIELDS}
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
        fields={FLIGHT_MAPPING_FIELDS}
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
        fields={FLIGHT_MAPPING_FIELDS}
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
      <ColumnMappingWizard
        fields={FLIGHT_MAPPING_FIELDS}
        csvHeaders={[]}
        csvSamples={{}}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings:import\.preview\.wizard\.cancel/i,
      })
    );
    expect(onCancel).toHaveBeenCalled();
  });

  // Regression test for a Critical bug: `useFlightMappingFields()` memoizes
  // on `[t]`, and the project's `useTranslation` wrapper returns a new `t`
  // identity every render (react-i18next returns a fresh array each render,
  // and the wrapper's `useCallback` deps track it) — so `fields` gets a new
  // array identity on every parent re-render (e.g. a 30s admin poll in
  // SettingsPage, or a language switch), even though its CONTENT is
  // unchanged. A prior implementation memoized `initial` on `[fields, ...]`
  // (identity), which recomputed and wiped the user's mapping on every such
  // re-render. This test reproduces exactly that: same content, new identity.
  it("keeps a user's manual selection across a parent re-render that only changes the `fields` array identity", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ColumnMappingWizard
        fields={FLIGHT_MAPPING_FIELDS}
        csvHeaders={["something_else", "toIata"]}
        csvSamples={{ something_else: "foo", toIata: "FCO" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    // The heuristic cannot map "date" from these headers — pick it manually.
    const dateSelect = screen.getByRole("combobox", { name: /fields\.date/i }) as HTMLSelectElement;
    expect(dateSelect.value).toBe("");
    fireEvent.change(dateSelect, { target: { value: "something_else" } });
    expect(dateSelect.value).toBe("something_else");

    // Re-render with a brand-new (but content-equal) `fields` array — this is
    // exactly what happens on every parent re-render in the real app.
    rerender(
      <ColumnMappingWizard
        fields={[...FLIGHT_MAPPING_FIELDS]}
        csvHeaders={["something_else", "toIata"]}
        csvSamples={{ something_else: "foo", toIata: "FCO" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    expect(
      (screen.getByRole("combobox", { name: /fields\.date/i }) as HTMLSelectElement).value
    ).toBe("something_else");
  });
});

type LodgingField = "name" | "city" | "checkIn";

const LODGING_FIELDS: MappingFieldSpec<LodgingField>[] = [
  { key: "name", label: "Name", required: true, aliases: ["name", "hotel", "unterkunft"] },
  { key: "city", label: "Stadt", aliases: ["city", "ort", "stadt"] },
  { key: "checkIn", label: "Anreise", aliases: ["checkin", "anreise"] },
];

describe("ColumnMappingWizard (generic)", () => {
  it("auto-maps by alias regardless of case and punctuation", () => {
    const mapping = autoMapHeaders(LODGING_FIELDS, ["Hotel", "Ort", "Check-In"]);
    expect(mapping).toEqual({ name: "Hotel", city: "Ort", checkIn: "Check-In" });
  });

  it("lets an initialMapping override the heuristic", () => {
    render(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={["Hotel", "Unterkunft", "Ort"]}
        csvSamples={{ Hotel: "NH", Unterkunft: "NH Lu", Ort: "Ludwigsburg" }}
        initialMapping={{ name: "Unterkunft" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Name") as HTMLSelectElement;
    expect(select.value).toBe("Unterkunft");
  });

  it("blocks submit while a required field is unmapped, and submits once it is", () => {
    const onSubmit = vi.fn();
    render(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={["Spalte A", "Ort"]}
        csvSamples={{ "Spalte A": "NH", Ort: "Ludwigsburg" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    const submit = screen.getByRole("button", { name: /weiter|continue/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spalte A" } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Spalte A", city: "Ort" });
  });

  // Regression test for the related trap the naive fix for the identity-churn
  // bug would create: an `initialMapping` (e.g. an LLM suggestion) that
  // arrives AFTER the wizard already mounted with the heuristic must only
  // fill fields the user has not touched yet — it must never discard a field
  // the user already picked manually.
  it("applies a late-arriving initialMapping only to untouched fields, without discarding a manual choice", () => {
    const onSubmit = vi.fn();
    const headers = ["Hotel", "Unterkunft", "Ort", "Datum Anreise"];
    const samples = {
      Hotel: "NH",
      Unterkunft: "NH Ludwigsburg",
      Ort: "Ludwigsburg",
      "Datum Anreise": "2024-06-01",
    };

    const { rerender } = render(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={headers}
        csvSamples={samples}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    // Heuristic auto-maps "name" -> "Hotel" (first alias match). Override it
    // manually before the suggestion arrives.
    const nameSelect = screen.getByLabelText("Name") as HTMLSelectElement;
    expect(nameSelect.value).toBe("Hotel");
    fireEvent.change(nameSelect, { target: { value: "Unterkunft" } });
    expect(nameSelect.value).toBe("Unterkunft");

    // "Datum Anreise" doesn't match the checkIn aliases ("checkin", "anreise"),
    // so the heuristic leaves it unmapped — the user hasn't touched it either.
    const checkInSelect = screen.getByLabelText("Anreise") as HTMLSelectElement;
    expect(checkInSelect.value).toBe("");

    // Simulate the suggestion landing a second later: same CSV (csvHeaders
    // unchanged), the wizard stays mounted, only `initialMapping` shows up.
    // It (wrongly, from the LLM's perspective) also suggests "name" -> "Hotel".
    rerender(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={headers}
        csvSamples={samples}
        initialMapping={{ name: "Hotel", checkIn: "Datum Anreise" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    // The user's manual choice survives ...
    expect((screen.getByLabelText("Name") as HTMLSelectElement).value).toBe("Unterkunft");
    // ... while the untouched field gets filled from the late suggestion.
    expect((screen.getByLabelText("Anreise") as HTMLSelectElement).value).toBe("Datum Anreise");
  });

  describe("a rejected mapping (Forgejo #15)", () => {
    /**
     * Mapping a lodging CSV so that nothing was readable — "640 dates
     * unreadable" — left "Weiter" enabled, and pressing it again produced the
     * identical failure. The wizard offered a way out of a dead end it already
     * knew about, so the user pressed the same button until they gave up.
     *
     * Both directions matter. Locking the button whenever an error is showing
     * would strand the wizard permanently, which is a worse bug than the one
     * being fixed — so the second test is the one that keeps the fix honest.
     */
    function renderWizard(submitError: string | null) {
      const onSubmit = vi.fn();
      const utils = render(
        <ColumnMappingWizard
          fields={FLIGHT_MAPPING_FIELDS}
          // One spare column nothing maps to, so the test can make a real
          // change without colliding with a field that already uses it.
          csvHeaders={[...FULL_HEADERS, "Spare"]}
          csvSamples={{ ...FULL_SAMPLES, Spare: "x" }}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          submitError={submitError}
        />
      );
      const button = screen.getByRole("button", {
        name: /settings:import\.preview\.wizard\.continue/i,
      });
      return { ...utils, onSubmit, button };
    }

    it("stops offering the same attempt after it was rejected", () => {
      const { button, onSubmit } = renderWizard(null);
      fireEvent.click(button);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      // The rejection comes back from the parent while the wizard stays open.
      cleanup();
      const second = renderWizard("no row could be read");
      fireEvent.click(second.button);
      expect(second.onSubmit).toHaveBeenCalledTimes(1);
      fireEvent.click(second.button);
      // Still one: the attempt that already failed is not repeated.
      expect(second.onSubmit).toHaveBeenCalledTimes(1);
      expect(second.button).toBeDisabled();
    });

    it("offers it again as soon as the mapping changes", () => {
      const { button, onSubmit } = renderWizard("no row could be read");
      fireEvent.click(button);
      expect(button).toBeDisabled();

      // Change any field and the attempt is worth making again, even before
      // anyone knows whether it will work. Unmapping an OPTIONAL column is the
      // smallest real change — the required ones must stay mapped or the button
      // would be disabled for a different reason and this would prove nothing.
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[selects.length - 1], { target: { value: "Spare" } });

      expect(
        screen.getByRole("button", { name: /settings:import\.preview\.wizard\.continue/i })
      ).not.toBeDisabled();
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

});
