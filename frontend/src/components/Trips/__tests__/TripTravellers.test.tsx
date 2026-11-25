import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const beta = vi.hoisted(() => ({ federated: false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    isFeatureVisible: (key: string) => key === "federatedTripSharing" && beta.federated,
  }),
}));
const demo = vi.hoisted(() => ({ shared: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.shared }));
const remote = vi.hoisted(() => ({ status: vi.fn(), tripSharing: vi.fn() }));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: remote }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../TripMoreMenu", () => ({ default: () => <div>more-menu</div> }));

import TripHead from "../TripHead";
import type { Trip } from "../../../types";

const t = ((key: string, o?: { count?: number }) => `${key}${o?.count ?? ""}`) as never;

function head(overrides: Partial<Trip> = {}) {
  const trip = {
    id: "t1",
    name: "Köln",
    status: "completed",
    countries: ["DE", "FR"],
    companions: ["Anna Beck", "Ben"],
    times: [],
    ...overrides,
  } as unknown as Trip;
  return render(
    <MemoryRouter>
      <TripHead
        trip={trip}
        locale="de"
        t={t}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onChanged={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("TripHead — the travellers under the country flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beta.federated = false;
    demo.shared = false;
  });

  it("renders the companions as a row that follows the country flags", () => {
    head();
    const row = screen.getByTestId("trip-head-travellers");
    expect(within(row).getByText("Anna Beck")).toBeInTheDocument();
    expect(within(row).getByText("Ben")).toBeInTheDocument();
    // After the flags in document order, and not in a separate panel.
    const flags = screen.getAllByRole("list")[0]!;
    expect(flags.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws nothing for a trip without travellers", () => {
    head({ companions: [] });
    expect(screen.queryByTestId("trip-head-travellers")).toBeNull();
  });

  it("folds the surplus into +N and unfolds it on a click", () => {
    head({ companions: ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"] });
    const row = screen.getByTestId("trip-head-travellers");
    expect(within(row).queryByText("H8")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: /trips:head.travellersMore/ }));
    expect(within(row).getByText("H8")).toBeInTheDocument();
  });

  it("adds the people on other servers, with their server written out", async () => {
    beta.federated = true;
    remote.status.mockResolvedValue({ available: true });
    remote.tripSharing.mockResolvedValue({
      members: [
        { id: "m1", displayName: "Cleo", origin: "other.example", state: "active" },
        { id: "m2", displayName: "Dan", origin: "other.example", state: "declined" },
      ],
    });
    head();
    const cleo = await screen.findByText("Cleo");
    expect(cleo.closest("li")).toHaveTextContent("@other.example");
    expect(screen.queryByText("Dan")).toBeNull();
  });

  it("lists a person once when the reader linked a companion to them (shared, with their handle)", async () => {
    beta.federated = true;
    remote.status.mockResolvedValue({ available: true });
    remote.tripSharing.mockResolvedValue({
      members: [
        {
          id: "m1",
          displayName: "Norbert",
          username: "norbert",
          origin: "https://trav.example",
          state: "active",
          companion: { id: "c1", name: "Ben" },
          nameMatches: [],
        },
      ],
    });
    head();
    const shared = await screen.findByTestId("traveller-shared");
    const row = screen.getByTestId("trip-head-travellers");
    expect(within(row).getAllByText("Ben")).toHaveLength(1);
    expect(shared.closest("li")).toHaveTextContent("norbert@trav.example");
    expect(within(row).getByText("Anna Beck")).toBeInTheDocument();
  });

  it("asks the other servers for nothing on the shared demo account", async () => {
    beta.federated = true;
    demo.shared = true;
    head();
    await waitFor(() => expect(screen.getByText("Anna Beck")).toBeInTheDocument());
    expect(remote.status).not.toHaveBeenCalled();
  });
});
