import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HIGHLIGHT_MS, useScrollToHash } from "../useScrollToHash";

function Page({ ready = true }: { ready?: boolean }): JSX.Element {
  useScrollToHash(ready);
  return (
    <ol>
      <li id="timeline-stop-s1">row</li>
    </ol>
  );
}

afterEach(() => vi.useRealTimers());

describe("useScrollToHash: the timeline link lands on its row", () => {
  it("scrolls to the row, focuses it and marks it, then lets the mark go", () => {
    vi.useFakeTimers();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(
      <MemoryRouter initialEntries={["/trips/t1?tab=timeline#timeline-stop-s1"]}>
        <Page />
      </MemoryRouter>
    );
    const row = container.querySelector("#timeline-stop-s1") as HTMLElement;
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("data-arrived")).toBe("true");
    expect(row.style.outline).toContain("var(--accent)");
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS + 10);
    });
    expect(row.hasAttribute("data-arrived")).toBe(false);
    expect(row.style.outline).toBe("");
  });

  it("does nothing until the timeline is ready, and nothing for a fragment with no row", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <MemoryRouter initialEntries={["/x#timeline-stop-s1"]}>
        <Page ready={false} />
      </MemoryRouter>
    );
    render(
      <MemoryRouter initialEntries={["/x#timeline-nope"]}>
        <Page />
      </MemoryRouter>
    );
    expect(scroll).not.toHaveBeenCalled();
  });
});
