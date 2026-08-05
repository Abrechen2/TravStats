import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import CatalogueCombobox, {
  searchAirlineOptions,
  searchAircraftOptions,
  type CatalogueOption,
} from "../CatalogueCombobox";

const mocks = vi.hoisted(() => ({ airlinesSearch: vi.fn(), aircraftSearch: vi.fn() }));

vi.mock("../../../../lib/api/catalogue", () => ({
  airlinesApi: { search: mocks.airlinesSearch },
  aircraftApi: { search: mocks.aircraftSearch },
}));

const OPTIONS: CatalogueOption[] = [
  { id: 1, name: "Lufthansa", codes: ["LH", "DLH"] },
  { id: 2, name: "Lufthansa CityLine", codes: ["CL", "CLH"] },
];

/** The combobox is fully controlled — interaction tests need a parent that
 *  folds onChange back into `value`, exactly like the real forms do. A bare
 *  vi.fn() onChange would leave `value` frozen and the debounced search
 *  would only ever see the initial prop. */
function renderControlled(opts: {
  search: (q: string) => Promise<CatalogueOption[]>;
  onChangeSpy?: (v: string) => void;
  initialValue?: string;
}) {
  const Harness = (): JSX.Element => {
    const [value, setValue] = useState(opts.initialValue ?? "");
    return (
      <CatalogueCombobox
        value={value}
        onChange={(v) => {
          opts.onChangeSpy?.(v);
          setValue(v);
        }}
        search={opts.search}
        placeholder="pick an airline"
      />
    );
  };
  const utils = render(<Harness />);
  const input = screen.getByPlaceholderText("pick an airline") as HTMLInputElement;
  return { ...utils, input };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CatalogueCombobox", () => {
  it("propagates every keystroke to onChange — free text is valid by construction", () => {
    const onChange = vi.fn();
    render(
      <CatalogueCombobox
        value=""
        onChange={onChange}
        search={vi.fn().mockResolvedValue([])}
        placeholder="pick an airline"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("pick an airline"), {
      target: { value: "My Tiny Airline Co." },
    });

    expect(onChange).toHaveBeenCalledWith("My Tiny Airline Co.");
  });

  it("renders the controlled value into the input", () => {
    render(
      <CatalogueCombobox
        value="Condor"
        onChange={vi.fn()}
        search={vi.fn().mockResolvedValue([])}
        placeholder="pick an airline"
      />
    );
    expect((screen.getByPlaceholderText("pick an airline") as HTMLInputElement).value).toBe(
      "Condor"
    );
  });

  it("searches the catalogue debounced and lists matches with their codes", async () => {
    const search = vi.fn().mockResolvedValue(OPTIONS);
    const { input } = renderControlled({ search });

    input.focus();
    fireEvent.change(input, { target: { value: "luf" } });

    await waitFor(() => expect(search).toHaveBeenCalledWith("luf"));
    await waitFor(() => expect(screen.getByText("Lufthansa")).toBeInTheDocument());
    expect(screen.getByText("LH / DLH")).toBeInTheDocument();
    expect(screen.getByText("Lufthansa CityLine")).toBeInTheDocument();
  });

  it("does not search below two characters", async () => {
    const search = vi.fn().mockResolvedValue(OPTIONS);
    const { input } = renderControlled({ search });

    input.focus();
    fireEvent.change(input, { target: { value: "l" } });

    // Past the debounce window — still nothing.
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  it("renders no dropdown at all when the catalogue has no match — free text is not an error", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { input, container } = renderControlled({ search });

    input.focus();
    fireEvent.change(input, { target: { value: "My Tiny Airline Co." } });

    await waitFor(() => expect(search).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("a pick replaces the value with the option's name and closes the dropdown", async () => {
    const onChangeSpy = vi.fn();
    const search = vi.fn().mockResolvedValue(OPTIONS);
    const { input } = renderControlled({ search, onChangeSpy });

    input.focus();
    fireEvent.change(input, { target: { value: "luf" } });
    await waitFor(() => expect(screen.getByText("Lufthansa")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Lufthansa"));

    expect(onChangeSpy).toHaveBeenLastCalledWith("Lufthansa");
    expect(input.value).toBe("Lufthansa");
    await waitFor(() => expect(screen.queryByText("Lufthansa CityLine")).not.toBeInTheDocument());
  });

  it("does not re-search and reopen for the value a pick just set", async () => {
    const search = vi.fn().mockResolvedValue(OPTIONS);
    const { input } = renderControlled({ search });

    input.focus();
    fireEvent.change(input, { target: { value: "luf" } });
    await waitFor(() => expect(screen.getByText("Lufthansa")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Lufthansa"));
    expect(input.value).toBe("Lufthansa");

    // Past the debounce window: the picked value must NOT trigger a fresh
    // search (which would reopen the dropdown under the user's cursor,
    // because the mousedown fix keeps the input focused through the pick).
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalledWith("Lufthansa");
    expect(screen.queryByText("Lufthansa CityLine")).not.toBeInTheDocument();
  });

  it("prevents the default mousedown on options so a pick never blurs the input", async () => {
    const search = vi.fn().mockResolvedValue(OPTIONS);
    const { input } = renderControlled({ search });

    input.focus();
    fireEvent.change(input, { target: { value: "luf" } });
    await waitFor(() => expect(screen.getByText("Lufthansa")).toBeInTheDocument());

    // fireEvent returns false iff some handler called preventDefault.
    const notPrevented = fireEvent.mouseDown(screen.getByText("Lufthansa"));
    expect(notPrevented).toBe(false);
  });
});

describe("catalogue search adapters", () => {
  it("maps airlines to options, dropping absent codes", async () => {
    mocks.airlinesSearch.mockResolvedValue([
      {
        id: 7,
        iata: "DE",
        icao: null,
        name: "Condor",
        callsign: "CONDOR",
        country: "Germany",
        active: true,
        isUserAdded: false,
      },
    ]);

    const options = await searchAirlineOptions("con");

    expect(mocks.airlinesSearch).toHaveBeenCalledWith("con");
    expect(options).toEqual([{ id: 7, name: "Condor", codes: ["DE"] }]);
  });

  it("maps aircraft to options, dropping absent codes", async () => {
    mocks.aircraftSearch.mockResolvedValue([
      { id: 3, icao: "A339", name: "Airbus A330-900", isUserAdded: false },
      { id: 4, icao: null, name: "Homebuilt Gyrocopter", isUserAdded: true },
    ]);

    const options = await searchAircraftOptions("a33");

    expect(mocks.aircraftSearch).toHaveBeenCalledWith("a33");
    expect(options).toEqual([
      { id: 3, name: "Airbus A330-900", codes: ["A339"] },
      { id: 4, name: "Homebuilt Gyrocopter", codes: [] },
    ]);
  });
});
