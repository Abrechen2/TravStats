import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CruiseStopsEditor } from "../CruiseStopsEditor";
import type { CruiseStopInput } from "../../../types";

/**
 * forgejo#126: touching anything in the editor — even an excursion note —
 * renumbered every stop to its list position, so a 7-night cruise's
 * disembarkation on day 8 was saved as day 2.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../PortPicker", () => ({ PortPicker: () => null }));

const kiel = (dayNumber: number): CruiseStopInput => ({
  portId: 1,
  dayNumber,
  isAtSea: false,
  excursionNote: "",
});

describe("CruiseStopsEditor — day of the cruise", () => {
  it("keeps day 8 when only a stop is removed", () => {
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={[kiel(1), kiel(4), kiel(8)]} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: "stops.remove" })[1]);

    expect(onChange.mock.calls[0][0].map((s: CruiseStopInput) => s.dayNumber)).toEqual([1, 8]);
  });

  it("gives an added stop the day after the last one", () => {
    const onChange = vi.fn();
    render(<CruiseStopsEditor stops={[kiel(1), kiel(8)]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /stops.add/ }));

    expect(onChange.mock.calls[0][0].map((s: CruiseStopInput) => s.dayNumber)).toEqual([1, 8, 9]);
  });
});
