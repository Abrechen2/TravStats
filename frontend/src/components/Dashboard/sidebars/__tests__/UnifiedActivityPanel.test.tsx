import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnifiedActivityPanel } from "../UnifiedActivityPanel";
import type { Lodging } from "../../../../types/lodging";

const lodging = (over: Partial<Lodging> = {}): Lodging =>
  ({
    id: "abc",
    name: "Hilton Berlin",
    chain: null,
    city: "Berlin",
    country: "Deutschland",
    lat: 52.5,
    lon: 13.4,
    stays: [],
    nights: 0,
    ...over,
  }) as unknown as Lodging;

describe("UnifiedActivityPanel", () => {
  // The behaviour this replaces: LodgingListPanel made every row a <Link> to
  // /lodging/:id, so clicking a hotel left the dashboard instead of focusing
  // it on the map. A row click now means the same thing in every domain.
  it("selects on click instead of navigating away", async () => {
    const onSelect = vi.fn();
    const onDetails = vi.fn();
    render(
      <UnifiedActivityPanel
        lodgings={[lodging()]}
        lockedKind="lodging"
        isOpen
        onClose={vi.fn()}
        onSelect={onSelect}
        onDetails={onDetails}
      />
    );
    await userEvent.click(screen.getByText("Hilton Berlin"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDetails).not.toHaveBeenCalled();
    expect(document.querySelector('a[href="/lodging/abc"]')).toBeNull();
  });

  it("opens the detail view from the row's arrow, not from the row", async () => {
    const onSelect = vi.fn();
    const onDetails = vi.fn();
    render(
      <UnifiedActivityPanel
        lodgings={[lodging()]}
        lockedKind="lodging"
        isOpen
        onClose={vi.fn()}
        onSelect={onSelect}
        onDetails={onDetails}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Carried over from LodgingListPanel: a row the map cannot focus has to say
  // so, otherwise the click just looks broken.
  it("marks a lodging the map cannot focus", () => {
    const { rerender } = render(
      <UnifiedActivityPanel
        lodgings={[lodging({ lat: null, lon: null })]}
        lockedKind="lodging"
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTitle("dashboard:sidebar.notOnMap")).toBeInTheDocument();

    rerender(
      <UnifiedActivityPanel
        lodgings={[lodging()]}
        lockedKind="lodging"
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTitle("dashboard:sidebar.notOnMap")).toBeNull();
  });

  it("hides the domain chips when the tab already picked a domain", () => {
    render(
      <UnifiedActivityPanel
        lodgings={[lodging()]}
        lockedKind="lodging"
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <UnifiedActivityPanel lodgings={[lodging()]} isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
