import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  setupApi: { getAirportSeedingStatus: vi.fn().mockResolvedValue({ seeded: true }) },
}));

import AirportAutocomplete from "../AirportAutocomplete";

/** forgejo#246/#249 — the picker names itself by its label and carries its field's error. */
describe("AirportAutocomplete — label and error", () => {
  it("is named by its visible label and tied to its error", async () => {
    render(
      <AirportAutocomplete
        id="dep"
        label="Abflughafen"
        value={null}
        onChange={vi.fn()}
        required
        error="Bitte einen Flughafen wählen."
      />
    );
    await act(async () => {});
    const input = screen.getByLabelText(/Abflughafen/);
    expect(input).toHaveAttribute("id", "dep");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent(
      "Bitte einen Flughafen wählen."
    );
  });

  it("carries no error attributes without one", async () => {
    render(<AirportAutocomplete id="dep" label="Abflughafen" value={null} onChange={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByLabelText(/Abflughafen/)).not.toHaveAttribute("aria-invalid");
  });
});
