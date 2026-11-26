import type { JSX } from "react";
/**
 * A visit date in a place list links to `/places/<id>#visit-<visitId>`: the place page scrolls
 * that row into view once the visits are drawn (owner 2026-11-26).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useScrollToVisit } from "../useScrollToVisit";

function Visits({ ids }: { ids: string[] }): JSX.Element {
  useScrollToVisit(ids.length);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} id={`visit-${id}`} />
      ))}
    </ul>
  );
}

describe("useScrollToVisit", () => {
  it("scrolls the linked visit into view once it is drawn, and marks it", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(
      <MemoryRouter initialEntries={["/places/p1#visit-v2"]}>
        <Visits ids={[]} />
      </MemoryRouter>
    );
    expect(scroll).not.toHaveBeenCalled();
    rerender(
      <MemoryRouter initialEntries={["/places/p1#visit-v2"]}>
        <Visits ids={["v1", "v2"]} />
      </MemoryRouter>
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.getElementById("visit-v2")?.getAttribute("data-highlighted")).toBe("true");
  });

  it("does nothing without a visit hash", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <MemoryRouter initialEntries={["/places/p1"]}>
        <Visits ids={["v1"]} />
      </MemoryRouter>
    );
    expect(scroll).not.toHaveBeenCalled();
  });
});
