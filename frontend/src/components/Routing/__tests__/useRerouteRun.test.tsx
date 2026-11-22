import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${String(o.count)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import RerouteRunStatus from "../RerouteRunStatus";
import { useRerouteRun } from "../useRerouteRun";
import type { RerouteRun } from "../../../lib/api/rerouteRuns";

const run = (over: Partial<RerouteRun> = {}): RerouteRun => ({
  id: "r1",
  scope: "instance",
  routeId: null,
  mode: "straight",
  status: "running",
  total: 10,
  processed: 4,
  routed: 3,
  kept: 1,
  failureCounts: {},
  failureSample: [],
  stopReason: null,
  resumeAfter: null,
  createdAt: "2026-11-22T10:00:00.000Z",
  finishedAt: null,
  ...over,
});

function Harness({
  read,
  start,
  cancel,
}: {
  read: () => Promise<RerouteRun | null>;
  start: () => Promise<RerouteRun>;
  cancel: (id: string) => Promise<RerouteRun>;
}) {
  const s = useRerouteRun({ read, start, cancel });
  return (
    <div>
      <button onClick={() => void s.start()}>start</button>
      {s.error && <p role="alert">{s.error}</p>}
      {s.run && <RerouteRunStatus run={s.run} onCancel={() => void s.cancel()} testId="run" />}
    </div>
  );
}

describe("RerouteRunStatus", () => {
  it("names each reason a line was kept, so a failed call is never a bare 'done'", () => {
    render(
      <RerouteRunStatus
        run={run({ status: "done", failureCounts: { no_route: 2, changed: 1 } })}
        onCancel={() => undefined}
        testId="run"
      />
    );
    expect(screen.getByText("routing:run.reason.no_route:2")).toBeTruthy();
    expect(screen.getByText("routing:run.reason.changed:1")).toBeTruthy();
  });

  it("says a quota pause resumes by itself, and offers the cancel", () => {
    render(
      <RerouteRunStatus
        run={run({
          status: "paused",
          stopReason: "rate_limited",
          resumeAfter: "2026-11-23T00:05:00.000Z",
        })}
        onCancel={() => undefined}
        testId="run"
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("routing:run.resumeAt");
    expect(screen.getByRole("status")).toHaveTextContent("routing:run.stop.rate_limited");
    expect(screen.getByRole("button", { name: "routing:run.cancel" })).toBeTruthy();
  });
});

describe("useRerouteRun", () => {
  it("shows the run that is already going when a start is refused as alreadyActive", async () => {
    const going = run();
    const refused = Object.assign(new Error("409"), {
      isAxiosError: true,
      response: { status: 409, data: { code: "alreadyActive", run: going } },
    });
    render(
      <Harness
        read={vi.fn().mockResolvedValueOnce(null).mockResolvedValue(going)}
        start={() => Promise.reject(refused)}
        cancel={async () => going}
      />
    );
    await act(async () => fireEvent.click(screen.getByText("start")));
    await waitFor(() => expect(screen.getByTestId("run")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when no routing service is set up instead of staying silent", async () => {
    const refused = Object.assign(new Error("409"), {
      isAxiosError: true,
      response: { status: 409, data: { code: "notConfigured" } },
    });
    render(
      <Harness
        read={async () => null}
        start={() => Promise.reject(refused)}
        cancel={async () => run()}
      />
    );
    await act(async () => fireEvent.click(screen.getByText("start")));
    expect((await screen.findByRole("alert")).textContent).toBe("notConfigured");
  });

  it("cancels the run it shows", async () => {
    const cancel = vi.fn(async () => run({ status: "cancelled" }));
    render(<Harness read={async () => run()} start={async () => run()} cancel={cancel} />);
    fireEvent.click(await screen.findByRole("button", { name: "routing:run.cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("r1"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("routing:run.status.cancelled")
    );
  });
});
