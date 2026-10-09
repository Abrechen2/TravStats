import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChecklistRow } from "../ChecklistRow";

/**
 * The tick box is a 22 px square — the size the iPad check measured as a
 * missed tap (forgejo#249). It keeps its look; on a coarse pointer an ::after
 * makes its hit area 44 px. jsdom cannot measure, so the classes are the
 * contract (the Tailwind output was checked once).
 */
const item = {
  itemId: "i1",
  name: "Chichén Itzá",
  nameEn: null,
  lat: 20.68,
  lon: -88.57,
  country: "Mexiko",
  isoCountryCode: "MX",
  continent: "north_america",
  blurb: null,
  blurbEn: null,
  ticked: false,
  placeId: null,
  lastVisitAt: null,
};

describe("ChecklistRow — touch target", () => {
  it("gives the tick box a 44 px hit area on a coarse pointer, and none on a mouse", () => {
    render(
      <MemoryRouter>
        <ChecklistRow
          item={item}
          suggestion={null}
          accent="#f0a947"
          busy={false}
          onToggle={vi.fn()}
        />
      </MemoryRouter>
    );
    const tick = screen.getByRole("button", { pressed: false });
    expect(tick.className).toContain("relative");
    expect(tick.className).toContain("pointer-coarse:after:absolute");
    expect(tick.className).toContain("pointer-coarse:after:-inset-[11px]");
    expect(tick.style.width).toBe("22px");
  });
});
