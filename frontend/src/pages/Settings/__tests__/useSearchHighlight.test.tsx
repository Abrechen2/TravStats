import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { HIGHLIGHT_MS, useSearchHighlight } from "../useSearchHighlight";

function Page({ loadFor }: { loadFor: number }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const highlighted = useSearchHighlight("admin");
  if (!loaded) setTimeout(() => setLoaded(true), loadFor);
  return (
    <>
      <p data-testid="active">{highlighted ?? ""}</p>
      {loaded && <section id="admin-push" />}
    </>
  );
}

const renderAt = (loadFor: number) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/admin/instance", state: { highlight: "push" } }]}>
      <Page loadFor={loadFor} />
    </MemoryRouter>
  );

afterEach(() => vi.useRealTimers());

/**
 * Codex review of forgejo#321: a hit into Administration lands on its loading
 * state; the mark's timer ran out before the section existed.
 */
describe("useSearchHighlight", () => {
  it("marks a section that mounts only after a slow load, for the full time", () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    renderAt(HIGHLIGHT_MS + 1000);
    // Still loading past the time a mark lasts: nothing to mark yet.
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS + 1000);
    });
    expect(screen.getByTestId("active")).toHaveTextContent("");
    // The section mounts; the next look finds it.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("active")).toHaveTextContent("push");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS);
    });
    expect(screen.getByTestId("active")).toHaveTextContent("");
  });
});
