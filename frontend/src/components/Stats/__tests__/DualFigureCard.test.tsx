import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import DualFigureCard from "../DualFigureCard";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

/**
 * The card that used to print "12E / 8W" as ONE string, which is why eight
 * served measures had no trigger anywhere on screen (owner ruling,
 * 2026-09-19). What is asserted here is the shape the ruling asked for: one
 * card, two buttons, the slash between them not a control.
 *
 * The stacking is asserted as a CLASS contract rather than a measured layout.
 * jsdom applies no stylesheet and evaluates no media query, so a test that
 * asked for the computed `flex-direction` at 390 px would read the inline
 * default and pass whatever the classes said — the failure mode this file
 * exists to prevent.
 */
function Probe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

function renderCard(): { search: () => string } {
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      <DualFigureCard
        title="East-West"
        first={{
          kind: "metric",
          evidenceKey: "eastwardFlightCount",
          scope: { period: "allTime" },
          renderedValue: 12,
          display: "12E",
          label: "Eastward flights",
        }}
        second={{
          kind: "metric",
          evidenceKey: "westwardFlightCount",
          scope: { period: "allTime" },
          renderedValue: 8,
          display: "8W",
          label: "Westward flights",
        }}
        description="ratio 1.5"
      />
      <Probe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  return { search: () => search };
}

describe("DualFigureCard", () => {
  it("gives each figure its own trigger, carrying its own key and figure", async () => {
    const { search } = renderCard();

    const east = screen.getByRole("button", { name: "Eastward flights" });
    const west = screen.getByRole("button", { name: "Westward flights" });
    expect(east).toHaveTextContent("12E");
    expect(west).toHaveTextContent("8W");

    const { useEvidenceOpenStore } = await import("../../evidence/evidenceOpenStore");

    await act(async () => {
      east.click();
    });
    expect(new URLSearchParams(search()).get("evidence")).toBe("metric:eastwardFlightCount");
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(12);

    await act(async () => {
      west.click();
    });
    expect(new URLSearchParams(search()).get("evidence")).toBe("metric:westwardFlightCount");
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(8);
  });

  it("has exactly two controls — the separator is not one of them", () => {
    renderCard();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    // Read out, "12E slash 8W" is not what the card says; the slash is a
    // typographic join between two independently named figures.
    expect(screen.getByText("/")).toHaveAttribute("aria-hidden", "true");
  });

  it("stacks the two figures below the sm breakpoint, and names each one there", () => {
    renderCard();
    const row = screen.getByTestId("dual-figure-row");
    // 390 px is below Tailwind's `sm` (640 px), so the base classes apply and
    // the `sm:` ones do not: the figures stack.
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("sm:flex-row");
    // Stacked, "12" over "8" is a fraction unless each says what it is, so the
    // captions appear exactly where the slash disappears.
    expect(screen.getByText("Eastward flights").className).toContain("sm:hidden");
    expect(screen.getByText("/").className).toContain("hidden");
    expect(screen.getByText("/").className).toContain("sm:inline");
  });
});
