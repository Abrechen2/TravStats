import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LocationInput } from "../LocationInput";

/**
 * A coordinate the user typed must not disappear without a word.
 *
 * Forgejo #9: entering 999 / -999 under "Erweitert" left both numbers sitting
 * in the fields, never called `onChange`, and let the dialog save a lodging
 * with no coordinates at all. The browser marked the inputs invalid; the
 * application never asked. The user sees a saved record, a row that reads "Nur
 * ein Name", and no explanation anywhere.
 *
 * The old code was a single bare `return` — the cheapest possible way to
 * discard input, and completely silent.
 *
 * Three things are pinned here, and the third is the one that keeps the fix
 * from being a new bug: a typo in one field must NOT throw away a location the
 * user already had.
 */
function openAdvanced(): void {
  // The coordinate fields live inside a <details>; jsdom renders them but the
  // summary has to be toggled for a real user to reach them.
  const details = document.querySelector("details");
  if (details) details.open = true;
}

function renderInput(onChange = vi.fn(), onValidityChange = vi.fn()) {
  const utils = render(
    <LocationInput value={null} onChange={onChange} onValidityChange={onValidityChange} />
  );
  openAdvanced();
  return { ...utils, onChange, onValidityChange };
}

describe("LocationInput — coordinates out of range", () => {
  it("says which value is wrong instead of swallowing it", () => {
    const { onChange } = renderInput();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("location:field.lon"), { target: { value: "-999" } });

    expect(screen.getByTestId("location-range-error")).toBeInTheDocument();
    // And the bad pair is still not passed off as a location.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells the surrounding form, so it can refuse to save", () => {
    const { onValidityChange } = renderInput();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("location:field.lon"), { target: { value: "999" } });

    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("names the offending field, not just 'invalid'", () => {
    renderInput();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("location:field.lon"), { target: { value: "999" } });
    expect(screen.getByTestId("location-range-error")).toHaveTextContent("location:lonOutOfRange");

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("location:field.lon"), { target: { value: "10" } });
    expect(screen.getByTestId("location-range-error")).toHaveTextContent("location:latOutOfRange");
  });

  it("clears the complaint and reports the location once the pair is valid", () => {
    const { onChange, onValidityChange } = renderInput();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("location:field.lon"), { target: { value: "8" } });
    expect(screen.getByTestId("location-range-error")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "48.1" } });

    expect(screen.queryByTestId("location-range-error")).toBeNull();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith({ lat: 48.1, lon: 8 });
  });

  it("does not throw away a location that was already chosen", () => {
    // The opposite mistake, and the worse one: reacting to a typo by clearing
    // the good coordinates would lose work the user had already done.
    const onChange = vi.fn();
    render(
      <LocationInput value={{ lat: 48.1, lon: 11.6 }} onChange={onChange} onValidityChange={vi.fn()} />
    );
    openAdvanced();

    fireEvent.change(screen.getByLabelText("location:field.lat"), { target: { value: "999" } });

    // Nothing was reported as the new location — in particular not a null or a
    // partial pair.
    expect(onChange).not.toHaveBeenCalled();
  });
});
