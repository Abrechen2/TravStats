import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { LocationInput } from "../LocationInput";

/**
 * forgejo#245 via the rail form (review 2026-10-08, minor 7): a caller can
 * mark the search as required — the shared asterisk beside the label and
 * `aria-required` on the input — and every caller that does not ask keeps
 * the field exactly as it was.
 */
describe("LocationInput — required", () => {
  it("marks the search as required when asked", () => {
    render(<LocationInput value={null} onChange={() => undefined} label="Bahnhof" required />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-required", "true");
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label?.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
  });

  it("adds neither the mark nor the attribute by default", () => {
    render(<LocationInput value={null} onChange={() => undefined} label="Ort" />);
    const input = screen.getByRole("combobox");
    expect(input).not.toHaveAttribute("aria-required");
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Ort");
  });
});
