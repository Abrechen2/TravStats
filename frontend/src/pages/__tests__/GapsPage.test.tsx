import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ access: "hidden" as string }));
vi.mock("../../hooks/useTravTrackVisible", () => ({
  useTravTrackState: () => ({ access: state.access, caps: null }),
}));
vi.mock("../../components/gap/GapCalendar", () => ({
  default: ({ withTrack }: { withTrack: boolean }) => (
    <div data-testid="calendar" data-with-track={String(withTrack)} />
  ),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import GapsPage from "../GapsPage";

/** `/gaps` must work for an account that has no TravTrack: entries alone explain days. */
describe("GapsPage", () => {
  beforeEach(() => {
    state.access = "hidden";
  });

  it("shows the calendar without TravTrack access, told not to expect fixes", () => {
    render(
      <MemoryRouter>
        <GapsPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("calendar").getAttribute("data-with-track")).toBe("false");
  });

  it("with TravTrack on, the calendar is told fixes can occur", () => {
    state.access = "visible";
    render(
      <MemoryRouter>
        <GapsPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("calendar").getAttribute("data-with-track")).toBe("true");
  });

  it("draws nothing while the TravTrack answer is pending, so no legend flashes states it may not have", () => {
    state.access = "pending";
    render(
      <MemoryRouter>
        <GapsPage />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("calendar")).toBeNull();
  });
});
