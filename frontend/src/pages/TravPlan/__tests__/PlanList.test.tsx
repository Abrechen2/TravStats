import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlanList } from "../PlanList";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { list: mocks.list, capabilities: mocks.capabilities },
}));

const base = {
  id: "p",
  tripId: "t",
  name: "Plan",
  revision: 1,
  destination: "Nordkap",
  startDay: "2026-07-01",
  endDay: "2026-07-20",
  status: "planning" as const,
  ideasCount: 7,
  bookingsCount: 2,
};

describe("plan list card counts", () => {
  it("shows stations and stages on a route plan instead of the idea count", async () => {
    mocks.capabilities.mockResolvedValue({ enabled: true });
    mocks.list.mockResolvedValue([
      { ...base, shape: "route", stationsCount: 5, stagesCount: 4 },
      { ...base, id: "q", tripId: "u", shape: "stay", stationsCount: 0, stagesCount: 0 },
    ]);
    render(
      <MemoryRouter>
        <PlanList />
      </MemoryRouter>
    );
    expect(await screen.findByText("listCountsRoute:5,4")).toBeInTheDocument();
    expect(screen.getByText("listCountsStay:7,2")).toBeInTheDocument();
  });
});
