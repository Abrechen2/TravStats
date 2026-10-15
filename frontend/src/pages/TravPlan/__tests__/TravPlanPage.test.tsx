import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import TravPlanPage from "../../TravPlanPage";
import { planFixture, deferred } from "./planFixture";
const mocks = vi.hoisted(() => ({ documents: vi.fn(), mutate: vi.fn(), t: (key: string) => key }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../components/ui/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../../lib/api/documents", () => ({ documentsApi: { listForEntry: mocks.documents } }));
vi.mock("../ImportPanel", () => ({ default: () => null }));
vi.mock("../usePlan", () => ({
  usePlan: (tripId: string) => ({
    plan: planFixture(tripId),
    loading: false,
    busy: false,
    error: "",
    setPlan: vi.fn(),
    setError: vi.fn(),
    refresh: vi.fn(),
    mutate: mocks.mutate,
    message: () => "failed",
  }),
}));
function NextTrip() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/plan/trip-two/import")}>Next trip</button>;
}
function open(section: string) {
  return render(
    <MemoryRouter initialEntries={["/plan/trip-one/" + section]}>
      <NextTrip />
      <Routes>
        <Route path="/plan/:tripId/:section" element={<TravPlanPage />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => {
  mocks.documents.mockReset().mockResolvedValue([]);
  mocks.mutate.mockReset().mockResolvedValue(true);
});
describe("travel-plan page boundaries", () => {
  it("removes the previous trip's document links before the next trip's documents arrive", async () => {
    const pending = deferred<unknown[]>();
    mocks.documents
      .mockResolvedValueOnce([
        { id: "old-doc", displayName: "First trip ticket", url: "https://example.invalid/old" },
      ])
      .mockReturnValueOnce(pending.promise);
    open("import");
    expect(await screen.findByRole("link", { name: "First trip ticket" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next trip" }));
    expect(screen.getByRole("heading", { name: "Journey trip-two" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "First trip ticket" })).not.toBeInTheDocument();
    await act(async () =>
      pending.resolve([
        { id: "new-doc", displayName: "Second trip ticket", url: "https://example.invalid/new" },
      ])
    );
    expect(await screen.findByRole("link", { name: "Second trip ticket" })).toBeInTheDocument();
    expect(mocks.documents).toHaveBeenLastCalledWith({ type: "trip", id: "trip-two" });
  });
  it("requires an explicit handover and explains that planning does not count as travel", async () => {
    open("handover");
    await act(async () => undefined);
    expect(screen.getByText("noAutoCount")).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "stats" })).toHaveAttribute("href", "/trips/trip-one");
    await userEvent.click(screen.getByRole("button", { name: "handover" }));
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ type: "handover" });
  });
});
