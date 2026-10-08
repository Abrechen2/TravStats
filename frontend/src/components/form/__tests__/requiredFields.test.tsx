/**
 * forgejo#245: a disabled save must say what is missing, without hover, and
 * stop saying it as soon as the field is filled.
 */
import { useState } from "react";
import type { JSX } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SaveBlockedHint from "../SaveBlockedHint";
import RequiredLegend from "../RequiredLegend";
import { focusFirstMissingRequired, RequiredMark } from "../requiredFields";
import { focusFirstMissingRequired as flightFocusFirstMissing } from "../../FlightForm/requiredFields";
import { readSectionFold } from "../../FlightForm/sectionFold";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function Form(): JSX.Element {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const missing = [
    ...(name.trim() === "" ? [{ field: "f-name", label: "Name" }] : []),
    ...(lat.trim() === "" ? [{ field: "f-lat", label: "Breitengrad" }] : []),
  ];
  return (
    <form>
      <label htmlFor="f-name">
        Name <RequiredMark />
      </label>
      <input
        id="f-name"
        aria-required="true"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <details>
        <summary>Erweitert</summary>
        <label htmlFor="f-lat">Breitengrad</label>
        <input id="f-lat" value={lat} onChange={(e) => setLat(e.target.value)} />
      </details>
      <RequiredLegend />
      <SaveBlockedHint id="f-hint" missing={missing} />
      <button type="button" disabled={missing.length > 0} aria-describedby="f-hint">
        Speichern
      </button>
    </form>
  );
}

describe("SaveBlockedHint", () => {
  it("names every missing step beside the disabled save, and the save is described by it", () => {
    render(<Form />);
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();
    // Joined the way the UI language joins a list (the suite runs in "en").
    // The accessible-name algorithm pads each item button with a space, so
    // the spacing is matched loosely on purpose.
    expect(save).toHaveAccessibleDescription(/^common:form\.saveBlocked Name\s+and\s+Breitengrad$/);
    expect(document.getElementById("f-hint")).toHaveAttribute("aria-live", "polite");
  });

  it("shrinks as fields become valid and disappears when nothing is missing", async () => {
    render(<Form />);
    await userEvent.type(screen.getByLabelText(/^Name/), "Adlon");
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent(
      "common:form.saveBlocked Breitengrad"
    );
    await userEvent.type(screen.getByLabelText("Breitengrad"), "52.5");
    expect(screen.queryByTestId("save-blocked-hint")).not.toBeInTheDocument();
    // The live region itself stays, so the NEXT change is still announced.
    expect(document.getElementById("f-hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
  });

  it("takes the cursor to the field, unfolding the section it sits in", async () => {
    render(<Form />);
    const details = screen.getByText("Erweitert").closest("details");
    expect(details?.open).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Breitengrad" }));
    expect(details?.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Breitengrad"));
  });
});

describe("RequiredLegend and RequiredMark", () => {
  it("explains the mark in words, and the mark itself is hidden from screen readers", () => {
    render(<Form />);
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("focusFirstMissingRequired", () => {
  it("focuses the first empty required control", () => {
    const { container } = render(<Form />);
    expect(focusFirstMissingRequired(container)).toBe(screen.getByLabelText(/^Name/));
  });

  it("from the flight path still remembers the fold it opened", () => {
    const { container } = render(
      <form>
        <details data-section="core">
          <summary>Kern</summary>
          <input aria-label="Von" aria-required="true" defaultValue="" />
        </details>
      </form>
    );
    flightFocusFirstMissing(container);
    expect(readSectionFold("core")).toBe(true);
  });
});
