import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TripPill from "../TripPill";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

const trip = { id: "trip-9", name: "Mittelmeer 2026", color: "#e88374" };

const renderPill = (ui: JSX.Element) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("TripPill", () => {
  it("links to the trip page and shows its name", () => {
    renderPill(<TripPill trip={trip} />);

    const link = screen.getByRole("link", { name: /Mittelmeer 2026/ });
    expect(link).toHaveAttribute("href", "/trips/trip-9");
  });

  // The pill is dropped into clickable rows and cards. Letting the click
  // bubble means opening the trip ALSO triggers whatever the container does —
  // the defect family that made a row's "delete" open the row behind it.
  it("keeps its click to itself", async () => {
    const onContainerClick = vi.fn();
    renderPill(
      <div onClick={onContainerClick}>
        <TripPill trip={trip} />
      </div>
    );

    await userEvent.click(screen.getByRole("link", { name: /Mittelmeer 2026/ }));

    expect(onContainerClick).not.toHaveBeenCalled();
  });

  it("renders a placeholder instead of a link when there is no trip", () => {
    renderPill(<TripPill trip={null} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // An unnamed trip is a real row: Trip.name is required in the schema, but a
  // whitespace-only name would otherwise render an empty, unclickable-looking
  // pill with no hint that a link is there at all.
  it("falls back to a label when the trip has a blank name", () => {
    renderPill(<TripPill trip={{ ...trip, name: "   " }} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/trips/trip-9");
    expect(link.textContent?.trim()).toBe("dashboard:trips.unnamed");
  });
});
