import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/** GET /trips caps its list; the page must say so instead of presenting a prefix as all trips. */
const getAllWithInsights = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ tripsApi: { getAllWithInsights } }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../components/Trips/TripsTab", () => ({
  default: ({ insights }: { insights: React.ReactNode }) => <div>{insights}</div>,
}));
vi.mock("../../components/Trips/TripInsightsBar", () => ({ TripInsightsBar: () => null }));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import TripsPage from "../TripsPage";

const trip = (id: string) => ({ id });

describe("TripsPage truncation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says how many of how many trips are shown when the server cut the list", async () => {
    getAllWithInsights.mockResolvedValue({
      trips: [trip("a"), trip("b")],
      mostExpensiveTrip: null,
      total: 650,
      truncated: true,
    });
    render(<TripsPage />);
    const note = await screen.findByTestId("trips-truncated");
    expect(note).toHaveTextContent("trips:listTruncated");
    expect(note).toHaveTextContent('"shown":2');
    expect(note).toHaveTextContent('"total":650');
  });

  it("shows no notice when the list is complete", async () => {
    getAllWithInsights.mockResolvedValue({
      trips: [trip("a")],
      mostExpensiveTrip: null,
      total: 1,
      truncated: false,
    });
    render(<TripsPage />);
    await waitFor(() => expect(getAllWithInsights).toHaveBeenCalled());
    expect(screen.queryByTestId("trips-truncated")).toBeNull();
  });
});
