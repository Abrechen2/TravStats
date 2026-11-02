import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlanList } from "../PlanList";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  invitations: vi.fn().mockResolvedValue([]),
  remote: vi.fn().mockResolvedValue([]),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/remotePlans", async (original) => ({
  ...(await original<typeof import("../../../lib/api/remotePlans")>()),
  remotePlansApi: { list: mocks.remote },
}));
vi.mock("../../../components/sharing/RemotePlanInvitations", () => ({ default: () => null }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: {
    list: mocks.list,
    capabilities: mocks.capabilities,
    invitations: mocks.invitations,
  },
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

  it("lists a plan on another server by whose it is and where, linking to the remote address", async () => {
    mocks.capabilities.mockResolvedValue({ enabled: true });
    mocks.list.mockResolvedValue([]);
    mocks.remote.mockResolvedValueOnce([
      {
        connectionId: "c1",
        origin: "https://far.example.org",
        planId: "p9",
        tripId: "t9",
        title: "Madeira",
        ownerDisplayName: "Ben",
        role: "editor",
        state: "active",
      },
      {
        connectionId: "c1",
        origin: "https://far.example.org",
        planId: "p8",
        tripId: "t8",
        title: "Only invited",
        ownerDisplayName: "Ben",
        role: "editor",
        state: "invited",
      },
    ]);
    render(
      <MemoryRouter>
        <PlanList />
      </MemoryRouter>
    );
    expect(await screen.findByText("Madeira")).toBeInTheDocument();
    expect(screen.getByText("remote.from:Ben,far.example.org")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "continue" })).toHaveAttribute(
      "href",
      "/plan/remote/c1/p9/overview"
    );
    expect(screen.queryByText("Only invited")).not.toBeInTheDocument();
  });

  it("names a failed load of the remote plans instead of showing an empty list", async () => {
    mocks.capabilities.mockResolvedValue({ enabled: true });
    mocks.list.mockResolvedValue([]);
    mocks.remote.mockRejectedValueOnce(new Error("down"));
    render(
      <MemoryRouter>
        <PlanList />
      </MemoryRouter>
    );
    expect(await screen.findByText("remote.listFailed")).toBeInTheDocument();
  });
});
