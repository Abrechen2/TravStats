import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RemotePlanScreen from "../RemotePlanScreen";
import {
  REMOTE_PLAN_ENDED_EVENT,
  getRemotePlanSource,
  remotePlansApi,
  type RemotePlanSummary,
} from "../../../lib/api/remotePlans";

const t = vi.hoisted(
  () => (key: string, params?: Record<string, string>) =>
    params && !("defaultValue" in params) ? `${key} ${JSON.stringify(params)}` : key
);
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../PlanContent", () => ({
  default: ({ tripId, remote }: { tripId: string; remote?: boolean }) => (
    <div data-testid="plan-content">{`${tripId}:${String(remote)}`}</div>
  ),
  PLAN_SECTIONS: ["overview"],
}));
vi.mock("../../../lib/api/remotePlans", async (original) => ({
  ...(await original<typeof import("../../../lib/api/remotePlans")>()),
  remotePlansApi: {
    list: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    leave: vi.fn(),
    exportTrip: vi.fn(),
  },
}));
const api = vi.mocked(remotePlansApi);

const plan = (over: Partial<RemotePlanSummary> = {}): RemotePlanSummary => ({
  connectionId: "c1",
  origin: "https://far.example.org",
  planId: "p1",
  tripId: "t1",
  title: "Madeira",
  ownerDisplayName: "Ben",
  role: "editor",
  state: "active",
  ...over,
});
const failure = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });
const renderScreen = () =>
  render(
    <MemoryRouter initialEntries={["/plan/remote/c1/p1/overview"]}>
      <Routes>
        <Route path="/plan" element={<div>plan list</div>} />
        <Route path="/plan/remote/:connectionId/:planId/:section?" element={<RemotePlanScreen />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("RemotePlanScreen", () => {
  it("opens the plan screens in remote mode with the host's trip, and names whose plan it is", async () => {
    api.list.mockResolvedValue([plan()]);
    renderScreen();
    expect(await screen.findByTestId("plan-content")).toHaveTextContent("t1:true");
    expect(screen.getByText(/remote.banner/)).toHaveTextContent("far.example.org");
    expect(getRemotePlanSource()).toEqual({ connectionId: "c1", planId: "p1", tripId: "t1" });
  });

  it("says the plan is no longer shared when it is not on the list, and when the host says so mid-session", async () => {
    api.list.mockResolvedValueOnce([]);
    const gone = renderScreen();
    expect(await screen.findByText("remote.ended.title")).toBeInTheDocument();
    gone.unmount();
    api.list.mockResolvedValueOnce([plan()]);
    renderScreen();
    await screen.findByTestId("plan-content");
    act(() => {
      window.dispatchEvent(
        new CustomEvent(REMOTE_PLAN_ENDED_EVENT, { detail: { code: "REMOTE_PLAN_NOT_SHARED" } })
      );
    });
    expect(await screen.findByText("remote.ended.title")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-content")).not.toBeInTheDocument();
  });

  it("keeps a retry when the list cannot be read, instead of an empty page", async () => {
    api.list.mockRejectedValueOnce(failure(503, "REMOTE_PLAN_UNREACHABLE"));
    renderScreen();
    expect(await screen.findByText("remote.unreachableTitle")).toBeInTheDocument();
    api.list.mockResolvedValueOnce([plan()]);
    await userEvent.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByTestId("plan-content")).toBeInTheDocument();
  });

  it("leaves the plan and returns to the list, and shows the reason when leaving fails", async () => {
    api.list.mockResolvedValue([plan()]);
    api.leave.mockRejectedValueOnce(failure(404, "REMOTE_PLAN_NOT_FOUND"));
    renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: "remote.leave" }));
    expect(await screen.findByText("errors.REMOTE_PLAN_NOT_FOUND")).toBeInTheDocument();
    api.leave.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: "remote.leave" }));
    expect(await screen.findByText("plan list")).toBeInTheDocument();
  });

  it("answers an invitation here: accepting reloads into the plan, a failure keeps the question", async () => {
    api.list.mockResolvedValueOnce([plan({ state: "invited" })]);
    api.accept.mockRejectedValueOnce(failure(503, "REMOTE_PLAN_UNREACHABLE"));
    renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: "members.accept" }));
    expect(await screen.findByText("errors.REMOTE_PLAN_UNREACHABLE")).toBeInTheDocument();
    api.accept.mockResolvedValueOnce(plan());
    api.list.mockResolvedValueOnce([plan()]);
    await userEvent.click(screen.getByRole("button", { name: "members.accept" }));
    expect(await screen.findByTestId("plan-content")).toBeInTheDocument();
  });
});
