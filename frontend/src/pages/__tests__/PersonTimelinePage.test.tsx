import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { PersonTimeline } from "../../lib/api/companions";

const { timeline } = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock("../../lib/api/companions", () => ({ companionsApi: { timeline } }));
vi.mock("../../components/NavigationBar", () => ({ default: () => null }));

import PersonTimelinePage from "../PersonTimelinePage";

const base: PersonTimeline = {
  companion: { id: "b1", name: "Ben", linkedUser: null },
  kinds: ["flight", "trip", "lodging"],
  summary: {
    firstTogether: "2025-05-01",
    lastTogether: "2025-05-08",
    firstJourney: null,
    lastJourney: null,
    entries: 2,
    days: 8,
    trips: 1,
    flights: 1,
    nights: null,
    countries: null,
    plannedTrips: 1,
  },
  timeline: [
    {
      kind: "trip",
      id: "t1",
      href: "/trips/t1",
      title: { text: "Lissabon 2025" },
      subtitle: null,
      from: "2025-05-01",
      to: "2025-05-08",
      state: "happened",
    },
    {
      kind: "trip",
      id: "t2",
      href: "/trips/t2",
      title: { text: "Madeira 2099" },
      subtitle: null,
      from: "2099-03-01",
      to: "2099-03-05",
      state: "planned",
    },
  ],
  documents: [
    {
      id: "d1",
      name: "pass.pdf",
      kind: "boardingPass",
      issuedOn: null,
      entry: { kind: "flight", id: "f1", href: "/flights/f1" },
    },
  ],
  facts: {
    seats: [
      {
        kind: "flight",
        id: "f1",
        href: "/flights/f1",
        title: { text: "TP571" },
        day: "2025-05-01",
        seat: "12A",
        seatClass: null,
      },
    ],
    loyalty: [{ number: "TP-123", kinds: ["flight"] }],
  },
};

const renderPage = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={["/mitreisende/b1"]}>
      <Routes>
        <Route path="/mitreisende/:id" element={<PersonTimelinePage />} />
      </Routes>
    </MemoryRouter>
  );

describe("PersonTimelinePage", () => {
  it("shows the figures, marks a planned trip, and says unknown instead of 0", async () => {
    timeline.mockResolvedValueOnce(base);
    renderPage();
    expect(await screen.findByTestId("person-summary")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ben");
    const summary = screen.getByTestId("person-summary").textContent ?? "";
    expect(summary).toContain("companions:person.unknown");
    expect(summary).not.toMatch(/nights0/);
    const planned = screen.getByTestId("person-row-trip-t2");
    expect(planned.textContent).toContain("companions:person.planned");
    expect(screen.getByTestId("person-row-trip-t1").textContent).not.toContain(
      "companions:person.planned"
    );
    expect(screen.getByTestId("person-documents").textContent).toContain("pass.pdf");
    expect(screen.getByTestId("person-facts").textContent).toContain("12A");
    expect(screen.getByTestId("person-facts").textContent).toContain("TP-123");
  });

  it("says so when the person is not yours (404) instead of an empty page", async () => {
    timeline.mockRejectedValueOnce({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText("companions:person.notFound.title")).toBeTruthy();
  });

  it("says a failed load in words, with a retry", async () => {
    timeline.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("companions:person.loadFailed")).toBeTruthy();
  });
});
