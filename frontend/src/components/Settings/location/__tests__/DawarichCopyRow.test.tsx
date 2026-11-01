import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import DawarichCopyRow from "../DawarichCopyRow";
import {
  dawarichCopyApi,
  type DawarichCopy,
  type DawarichCopyState,
} from "../../../../lib/api/travtrackDawarichCopy";

const TOTALS = {
  read: 100,
  stored: 90,
  duplicate: 0,
  dropped: { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 },
  truncatedHours: 0,
  unreachableDays: 0,
  daysWithPoints: 10,
};
const copy = (over: Partial<DawarichCopy> = {}): DawarichCopy => ({
  importId: "i1",
  status: "complete",
  fromDay: "2026-01-01",
  untilDay: "2026-01-31",
  nextDay: "2026-01-12",
  daysDone: 11,
  daysTotal: 31,
  lastErrorKind: null,
  createdAt: "",
  finishedAt: null,
  totals: TOTALS,
  months: [],
  ...over,
});
const own = (c: DawarichCopy | null = null): DawarichCopyState => ({ connection: "own", copy: c });
const failure = (status = 500, code?: string) =>
  Object.assign(new Error("x"), { response: { status, data: { code } } });
const show = (canStart = true, onChanged = vi.fn()) =>
  render(
    <MemoryRouter>
      <DawarichCopyRow canStart={canStart} onChanged={onChanged} />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
});
afterEach(() => cleanup());

describe("Verlauf → Aus Dawarich übernehmen", () => {
  it("needs the account's own connection: the server's is not enough, and the row jumps to it", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "shared", copy: null });
    show();
    expect(await screen.findByText("track:dawarichCopy.connection.shared")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "settings:location.history.copy.start" })
    ).toBeNull();
    fireEvent.click(screen.getByText(/settings:blocks\.dep\.noOwnDawarich\.jump/));
    expect(navigate.mock.calls[0][0]).toContain("service=dawarich");
  });

  it("copies everything, or only a period, once the period is complete", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own());
    const start = vi.spyOn(dawarichCopyApi, "start").mockResolvedValue();
    show();
    const button = await screen.findByRole("button", {
      name: "settings:location.history.copy.start",
    });
    await userEvent.click(button);
    await waitFor(() => expect(start).toHaveBeenCalledWith(null));

    await userEvent.click(
      screen.getByRole("radio", { name: "settings:location.history.copy.span" })
    );
    expect(
      screen.getByRole("button", { name: "settings:location.history.copy.start" })
    ).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("settings:location.history.copy.from"),
      "2026-01-01"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.history.copy.until"),
      "2026-01-31"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "settings:location.history.copy.start" })
    );
    await waitFor(() =>
      expect(start).toHaveBeenLastCalledWith({ fromDay: "2026-01-01", untilDay: "2026-01-31" })
    );
  });

  it("a refused start says why in its own words and retries on the row", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own());
    const start = vi
      .spyOn(dawarichCopyApi, "start")
      .mockRejectedValueOnce(failure(409, "TRAVTRACK_IMPORT_RUNNING"))
      .mockResolvedValueOnce();
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:location.history.copy.start" })
    );
    expect(await screen.findByText(/track:dawarichCopy\.errors\.running/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it("shows a running copy with its progress, and stops it on request", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own(copy({ status: "running" })));
    const stop = vi
      .spyOn(dawarichCopyApi, "stop")
      .mockResolvedValue(own(copy({ status: "paused" })));
    show();
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");
    await userEvent.click(
      screen.getByRole("button", { name: "settings:location.history.copy.stop" })
    );
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("offers to resume a paused copy, and a failed one names Dawarich's reason", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own(copy({ status: "paused" })));
    const resume = vi.spyOn(dawarichCopyApi, "resume").mockResolvedValue();
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:blocks.job.resume" })
    );
    await waitFor(() => expect(resume).toHaveBeenCalled());
    cleanup();
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(
      own(copy({ status: "failed", lastErrorKind: "auth" }))
    );
    show();
    expect(await screen.findByText(/track:dawarichCopy\.reason\.auth/)).toBeInTheDocument();
  });

  it("an incomplete copy is not 'fertig': it lists the hours and days it could not get", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(
      own(
        copy({
          status: "incomplete",
          months: [
            {
              month: "2026-01",
              read: 1,
              stored: 1,
              duplicate: 0,
              dropped: TOTALS.dropped,
              truncatedHours: ["2026-01-03T10"],
              unreachableDays: ["2026-01-09"],
              daysWithPoints: 1,
            },
          ],
        })
      )
    );
    show();
    expect(
      await screen.findByText(/settings:location\.history\.copy\.resultIncomplete/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("settings:location.history.copy.gaps")).toHaveTextContent(
      "2026-01"
    );
  });

  it("says it does not know when the state of a running copy can no longer be read", async () => {
    const get = vi
      .spyOn(dawarichCopyApi, "get")
      .mockResolvedValueOnce(own(copy({ status: "running" })))
      .mockRejectedValue(failure());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show();
      await screen.findByRole("progressbar");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(await screen.findByText("settings:blocks.job.unknown")).toBeInTheDocument();
      get.mockResolvedValue(own(copy({ status: "complete" })));
      await userEvent.click(screen.getByRole("button", { name: "settings:blocks.job.check" }));
      expect(await screen.findByText(/settings:blocks\.job\.done/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps asking after repeated failed reads, and recovers when the server answers again", async () => {
    const get = vi
      .spyOn(dawarichCopyApi, "get")
      .mockResolvedValueOnce(own(copy({ status: "running" })))
      .mockRejectedValueOnce(failure())
      .mockRejectedValueOnce(failure())
      .mockRejectedValueOnce(failure())
      .mockResolvedValue(own(copy({ status: "complete" })));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show();
      await screen.findByRole("progressbar");
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3100);
        });
      }
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(await screen.findByText(/settings:blocks\.job\.done/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no resume or retry where the row is locked (demo, TravTrack off)", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own(copy({ status: "paused" })));
    show(false);
    await screen.findByText("settings:blocks.lock.demo");
    expect(screen.queryByRole("button", { name: "settings:blocks.job.resume" })).toBeNull();
    cleanup();
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(
      own(copy({ status: "failed", lastErrorKind: "auth" }))
    );
    show(false);
    await screen.findByText(/track:dawarichCopy\.reason\.auth/);
    expect(screen.queryByRole("button", { name: "settings:blocks.job.retry" })).toBeNull();
  });

  it("reports a copy that ended, so the stored positions are read again", async () => {
    const onChanged = vi.fn();
    const get = vi
      .spyOn(dawarichCopyApi, "get")
      .mockResolvedValueOnce(own(copy({ status: "running" })))
      .mockResolvedValue(own(copy({ status: "complete" })));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(true, onChanged);
      await screen.findByRole("progressbar");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hide a state it could not load, and loads again on request", async () => {
    const get = vi.spyOn(dawarichCopyApi, "get").mockRejectedValueOnce(failure());
    show();
    expect(await screen.findByText("settings:location.history.copy.loadError")).toBeInTheDocument();
    get.mockResolvedValue(own());
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() =>
      expect(screen.queryByText("settings:location.history.copy.loadError")).toBeNull()
    );
  });

  it("is locked while TravTrack is off or for the demo account", async () => {
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue(own());
    show(false);
    await screen.findByText("settings:blocks.lock.demo");
    expect(
      screen.queryByRole("button", { name: "settings:location.history.copy.start" })
    ).toBeNull();
  });
});
