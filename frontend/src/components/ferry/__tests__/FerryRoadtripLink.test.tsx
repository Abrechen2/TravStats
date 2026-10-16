import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FerryRoadtripLink } from "../FerryRoadtripLink";
import type { FerryJourney } from "../../../types/ferry";

const mocks = vi.hoisted(() => ({ legs: vi.fn() }));
vi.mock("../../../lib/api/ferry", () => ({
  ferryApi: { roadtripLegs: mocks.legs, linkLeg: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const ride = { id: "f1", tripId: null, roadtripLegId: null } as unknown as FerryJourney;
const leg = {
  id: "l1",
  mode: "road",
  ferryJourney: null,
  fromStop: { title: "Bari" },
  toStop: { title: "Dubrovnik" },
  route: { name: "Adria", tripId: null },
};

describe("FerryRoadtripLink", () => {
  it("says when the picker does not list every leg", async () => {
    // The server cut the list at 500 legs without a word, so an older leg
    // simply was not there and nothing said why.
    mocks.legs.mockResolvedValue({ legs: [leg], truncated: true });
    render(<FerryRoadtripLink ride={ride} onSaved={vi.fn()} />);
    expect(await screen.findByText("ferry:roadtrip.truncated")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Adria: Bari → Dubrovnik" })).toBeInTheDocument();
  });

  it("says nothing extra when every leg is listed", async () => {
    mocks.legs.mockResolvedValue({ legs: [leg], truncated: false });
    render(<FerryRoadtripLink ride={ride} onSaved={vi.fn()} />);
    expect(
      await screen.findByRole("option", { name: "Adria: Bari → Dubrovnik" })
    ).toBeInTheDocument();
    expect(screen.queryByText("ferry:roadtrip.truncated")).toBeNull();
  });
});
