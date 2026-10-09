import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LocationInput } from "../LocationInput";

/**
 * What a screen reader and the form's "first error" focus find on the field
 * (forgejo#245, forgejo#246).
 *
 * A place cannot be saved without a position, and the search field said so
 * nowhere: the label is a plain string, so no form could put the required
 * mark on it. And a refused coordinate was a red line under the pair — the
 * number field itself announced nothing and `focusFirstError` had no
 * `aria-invalid` to find.
 */
function openAdvanced(): void {
  const details = document.querySelector("details");
  if (details) details.open = true;
}

describe("LocationInput — required mark and refused coordinates", () => {
  it("marks the search field as required when the form needs a position", () => {
    render(<LocationInput value={null} onChange={vi.fn()} idPrefix="p" required />);
    const search = screen.getByRole("combobox");
    expect(search).toHaveAttribute("aria-required", "true");
    // The visible mark sits in the label, hidden from the accessible name.
    expect(document.querySelector('label[for="p-search"] [aria-hidden="true"]')?.textContent).toBe(
      "*"
    );
  });

  it("says nothing of the kind when the position is optional", () => {
    render(<LocationInput value={null} onChange={vi.fn()} idPrefix="p" />);
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-required");
  });

  it("marks only the refused coordinate invalid and describes it with the message", () => {
    render(<LocationInput value={null} onChange={vi.fn()} idPrefix="p" />);
    openAdvanced();
    const lat = screen.getByLabelText("location:field.lat");
    const lon = screen.getByLabelText("location:field.lon");

    fireEvent.change(lat, { target: { value: "10" } });
    fireEvent.change(lon, { target: { value: "999" } });

    expect(lon).toHaveAttribute("aria-invalid", "true");
    expect(lon).toHaveAttribute("aria-describedby", "p-range-error");
    expect(document.getElementById("p-range-error")).toHaveTextContent("location:lonOutOfRange");
    expect(lat).not.toHaveAttribute("aria-invalid");
  });

  it("clears the mark once the value is corrected", () => {
    render(<LocationInput value={null} onChange={vi.fn()} idPrefix="p" />);
    openAdvanced();
    const lat = screen.getByLabelText("location:field.lat");
    const lon = screen.getByLabelText("location:field.lon");
    fireEvent.change(lat, { target: { value: "999" } });
    fireEvent.change(lon, { target: { value: "10" } });
    expect(lat).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(lat, { target: { value: "52" } });
    expect(lat).not.toHaveAttribute("aria-invalid");
    expect(lon).not.toHaveAttribute("aria-invalid");
  });
});
