import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TimeValue } from "../../../shared/time";

const visible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackVisible: () => visible.value,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

import FlightProfileLink from "../FlightProfileLink";

/**
 * "Höhenprofil ansehen" on the flight's page (owner 2026-10-26): it opens the
 * Track map on the departure airport's own day with the flight's panel open,
 * and only where TravTrack is offered.
 */

// 00:30 in Seoul on the 17th is still the 16th in UTC: the link takes the airport's day.
const seoul: TimeValue = {
  utc: "2026-10-16T15:30:00Z",
  zone: "Asia/Seoul",
  offset: "+09:00",
  local: "2026-10-17T00:30:00",
  precision: "minute",
};

const show = (departure: TimeValue | null) =>
  render(
    <MemoryRouter>
      <FlightProfileLink flightId="f1" departure={departure} />
    </MemoryRouter>
  );

describe("FlightProfileLink", () => {
  beforeEach(() => {
    visible.value = true;
  });

  it("links to the departure airport's day with the flight's panel open", () => {
    show(seoul);
    expect(screen.getByRole("link", { name: "track:flight.openProfile" })).toHaveAttribute(
      "href",
      "/track/2026-10-17?flight=f1"
    );
  });

  it("is not shown without TravTrack, nor without a departure", () => {
    visible.value = false;
    const { container, unmount } = show(seoul);
    expect(container).toBeEmptyDOMElement();
    unmount();
    visible.value = true;
    expect(show(null).container).toBeEmptyDOMElement();
  });
});
