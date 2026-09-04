import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ExpandableEventCard } from "../../components/Trip/ExpandableEventCard";

/**
 * The card that opens a timeline entry in place.
 *
 * The reported gap: a cruise on a trip's timeline could not be opened at all,
 * while the hotel two cards below it navigated to its own page. This card is
 * the answer for the cruise and the flight: a normal click expands it, and the
 * expanded panel carries the link to the full page.
 *
 * Test i18n returns raw keys, so assertions match keys rather than German copy.
 */
function setup(over: Partial<React.ComponentProps<typeof ExpandableEventCard>> = {}) {
  const onToggle = vi.fn();
  const props = {
    icon: "⚓",
    bg: "rgba(111,160,214,0.15)",
    iconColor: "#6fa0d6",
    title: "Mein Schiff 4",
    subtitle: "12.05. → 19.05.",
    date: "2026-05-12T00:00:00.000Z",
    expanded: false,
    onToggle,
    detailsLabel: "trips:detail.timeline.showDetails",
    children: <div data-testid="panel">Etappen</div>,
    ...over,
  };
  const view = render(
    <MemoryRouter>
      <ExpandableEventCard {...props} />
    </MemoryRouter>
  );
  return { onToggle, view };
}

describe("ExpandableEventCard", () => {
  it("keeps the panel closed until it is asked for", () => {
    setup();
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("opens on a normal click on the card", () => {
    // The owner's words: "aufklappen bei normalen klick".
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Mein Schiff 4/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the panel and says it is open", () => {
    setup({ expanded: true });
    expect(screen.getByTestId("panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mein Schiff 4/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("does NOT nest the jump link inside the toggle button", () => {
    // This project has already shipped the other arrangement: a clickable row
    // swallowed the buttons inside it, so "delete" opened the flight it was
    // meant to delete — with every test green. A link inside a <button> is also
    // invalid HTML, and the browser resolves it by ignoring one of them.
    setup({
      expanded: true,
      children: (
        <a href="/cruises/abc" data-testid="jump">
          trips:detail.timeline.openCruise
        </a>
      ),
    });
    const toggle = screen.getByRole("button", { name: /Mein Schiff 4/ });
    expect(within(toggle).queryByTestId("jump")).toBeNull();
    expect(screen.getByTestId("jump")).toBeTruthy();
  });

  it("lets the jump link be clicked without collapsing the card", () => {
    const { onToggle } = setup({
      expanded: true,
      children: (
        <a href="/cruises/abc" data-testid="jump">
          öffnen
        </a>
      ),
    });
    fireEvent.click(screen.getByTestId("jump"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("is reachable from the keyboard", () => {
    // It is a real button, so Enter and Space work without a key handler of
    // our own. Pinning the element type is what keeps that true.
    setup();
    const toggle = screen.getByRole("button", { name: /Mein Schiff 4/ });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
  });
});

/**
 * `Cruise.cabinType` is typed as a four-value enum and is not one in practice.
 * Measured 2026-08-29: the demo seed alone holds thirteen distinct free-text
 * values, and a parsed booking can carry whatever the line calls its cabins.
 * Translating blindly put the raw key "cabinType.Balkon" in front of a user.
 */
describe("cabinLabel", () => {
  const t = ((key: string) => key) as never;
  let cabinLabel: (typeof import("../TripDetailPage"))["cabinLabel"];

  /**
   * The import is the expensive part, not the assertions: it pulls a
   * 1700-line page module and its whole dependency tree through the
   * transform pipeline. Inside a test it counted against the 5s default, and
   * under the full suite — where the environment alone takes minutes — that
   * budget ran out and failed whichever cabinLabel test happened to import
   * first. Green alone, red in company, and nothing to do with cabin labels.
   *
   * Paying it once in beforeAll, with room, makes the cost explicit and
   * leaves the three tests measuring only what they are about.
   */
  beforeAll(async () => {
    ({ cabinLabel } = await import("../TripDetailPage"));
  }, 30_000);

  it("translates the four types the schema names", () => {
    expect(cabinLabel("balcony", t)).toBe("cruise:cabinType.balcony");
    expect(cabinLabel("inside", t)).toBe("cruise:cabinType.inside");
  });

  it("shows an unknown cabin exactly as it is stored", () => {
    // A word we cannot translate is still a word the user recognises.
    expect(cabinLabel("Balkonkabine", t)).toBe("Balkonkabine");
    expect(cabinLabel("The Haven Penthouse", t)).toBe("The Haven Penthouse");
  });

  it("says nothing when there is no cabin", () => {
    expect(cabinLabel(null, t)).toBeNull();
    expect(cabinLabel("", t)).toBeNull();
  });
});
