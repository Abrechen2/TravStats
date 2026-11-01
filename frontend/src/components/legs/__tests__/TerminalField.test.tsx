import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
    searchKind,
  }: {
    onChange: (s: Record<string, unknown>) => void;
    searchKind?: string;
  }) => (
    <>
      <span data-testid="kind">{searchKind ?? "all"}</span>
      <button
        type="button"
        onClick={() => onChange({ lat: 52.5, lon: 13.3, name: "Hafen", address: "Kai 1" })}
      >
        pick with address
      </button>
      <button type="button" onClick={() => onChange({ lat: 52.5, lon: 13.3, name: "Hafen" })}>
        pick without address
      </button>
    </>
  ),
}));

import { EMPTY_TERMINAL, TerminalField, type TerminalDomain } from "../TerminalField";

const TYPED = { ...EMPTY_TERMINAL, name: "Typed", address: "Typed street" };

function setup(ns: TerminalDomain["ns"], portSearch = false): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <TerminalField
      domain={{ ns, portSearch }}
      label="Von"
      idPrefix="dep"
      value={TYPED}
      onChange={onChange}
      inputClassName="x"
    />
  );
  return onChange;
}

describe("TerminalField address merging (forgejo#386 REF-2: bus dropped the pick's address, ferry took it)", () => {
  it.each(["bus", "ferry"] as const)("%s: a pick that brings an address replaces it", (ns) => {
    const onChange = setup(ns);
    fireEvent.click(screen.getByText("pick with address"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: "Kai 1" }));
  });

  it.each(["bus", "ferry"] as const)("%s: a pick without one keeps the typed address", (ns) => {
    const onChange = setup(ns);
    fireEvent.click(screen.getByText("pick without address"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: "Typed street" }));
  });
});

describe("TerminalField port search", () => {
  it("ferry searches ferry terminals until all places is ticked; bus never narrows", () => {
    setup("ferry", true);
    expect(screen.getByTestId("kind").textContent).toBe("ferry_terminal");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("kind").textContent).toBe("all");
  });

  it("bus has no port-search controls", () => {
    setup("bus");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByTestId("kind").textContent).toBe("all");
  });
});
