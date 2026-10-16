import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ConsentDialog from "../ConsentDialog";
import { comparisonApi } from "../../../lib/api/comparison";
import type { LeaderboardSnapshot } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "name" in o
        ? `${k}:${String(o.name)}`
        : o && "origin" in o
          ? `${k}:${String(o.origin)}`
          : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "ferry"], isEnabled: () => true }),
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: { preview: vi.fn() },
}));

const snapshot: LeaderboardSnapshot = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T00:00:00.000Z",
  year: null,
  domains: ["flight", "ferry"],
  metrics: { flights: 12, ferryCrossings: 2 },
  partial: [],
};
const person = { displayName: "Ben", origin: null };

describe("ConsentDialog", () => {
  beforeEach(() => {
    vi.mocked(comparisonApi.preview).mockReset();
    vi.mocked(comparisonApi.preview).mockResolvedValue(snapshot);
  });

  it("shows the numbers the scope would share and confirms exactly that scope", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByText("consent.title:Ben")).toBeInTheDocument();
    expect(await screen.findByText("metric.flights")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "group.time", pressed: true }));
    await waitFor(() =>
      expect(comparisonApi.preview).toHaveBeenLastCalledWith({
        groups: ["distance", "trips", "places"],
        domains: ["flight", "ferry"],
        year: null,
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "consent.share" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        groups: ["distance", "trips", "places"],
        domains: ["flight", "ferry"],
        year: null,
      })
    );
  });

  it("says in plain words that another server reads the numbers", async () => {
    render(
      <ConsentDialog
        open
        person={{ displayName: "Far", origin: "https://far.example" }}
        onClose={() => {}}
        onConfirm={vi.fn()}
      />
    );
    expect(await screen.findByText("consent.remoteNotice:https://far.example")).toBeInTheDocument();
  });

  it("cannot share nothing", async () => {
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    for (const group of ["distance", "trips", "time", "places"])
      fireEvent.click(screen.getByRole("button", { name: `group.${group}` }));
    expect(await screen.findByText("consent.nothingChosen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "consent.share" })).toBeDisabled();
  });

  it("states that nothing is shared until the other person has agreed too", async () => {
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(await screen.findByText("consent.pendingNotice:Ben")).toBeInTheDocument();
    await screen.findByText("metric.flights");
  });

  it("asks the server once for a burst of toggles (debounced), with the final scope", async () => {
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "group.time" }));
    fireEvent.click(screen.getByRole("button", { name: "group.places" }));
    fireEvent.click(screen.getByRole("button", { name: "group.trips" }));
    expect(await screen.findByText("metric.flights")).toBeInTheDocument();
    expect(comparisonApi.preview).toHaveBeenCalledTimes(1);
    expect(comparisonApi.preview).toHaveBeenCalledWith({
      groups: ["distance"],
      domains: ["flight", "ferry"],
      year: null,
    });
  });

  it("says 'too many requests' on a 429, not 'preview failed'", async () => {
    vi.mocked(comparisonApi.preview).mockRejectedValue(
      new AxiosError("busy", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 429,
        data: "Too many requests",
      } as AxiosResponse)
    );
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(await screen.findByText("error.rateLimited")).toBeInTheDocument();
    expect(screen.queryByText("consent.previewFailed")).not.toBeInTheDocument();
  });

  it("prints a dash for a figure that is shared but not derivable, never 0", async () => {
    vi.mocked(comparisonApi.preview).mockResolvedValue({
      ...snapshot,
      metrics: { flights: null },
    });
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(await screen.findByText("metric.flights")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  it("cannot confirm a scope whose numbers have not arrived yet", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={onConfirm} />);
    await screen.findByText("metric.flights");
    const share = screen.getByRole("button", { name: "consent.share" });
    expect(share).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "group.time" }));
    expect(share).toBeDisabled();
    expect(screen.queryByText("12")).not.toBeInTheDocument();
    fireEvent.click(share);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "consent.share" })).toBeEnabled()
    );
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("offers no chip for a domain that is not enabled and never sends it", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConsentDialog
        open
        person={person}
        onClose={() => {}}
        onConfirm={onConfirm}
        initialScope={{ groups: ["trips"], domains: ["flight", "cruise"], year: null }}
      />
    );
    expect(screen.queryByRole("button", { name: "common:domain.cruise" })).not.toBeInTheDocument();
    await screen.findByText("metric.flights");
    fireEvent.click(screen.getByRole("button", { name: "consent.share" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ groups: ["trips"], domains: ["flight"], year: null })
    );
  });

  it("lists an initial year that is outside the recent years", async () => {
    render(
      <ConsentDialog
        open
        person={person}
        onClose={() => {}}
        onConfirm={vi.fn()}
        initialScope={{ groups: ["trips"], domains: ["flight"], year: 1999 }}
      />
    );
    expect(screen.getByRole("combobox")).toHaveValue("1999");
    await screen.findByText("metric.flights");
  });

  it("toggles a chip with Space and says so through aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "group.time" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    chip.focus();
    await user.keyboard(" ");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await screen.findByText("metric.flights");
  });

  it("discards a response that belongs to an older scope", async () => {
    let releaseFirst: (s: LeaderboardSnapshot) => void = () => {};
    vi.mocked(comparisonApi.preview)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue({ ...snapshot, metrics: { flights: 99 } });
    render(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    await waitFor(() => expect(comparisonApi.preview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "group.time" }));
    expect(await screen.findByText("99")).toBeInTheDocument();
    await act(async () => releaseFirst(snapshot));
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("starts from the initial scope again when it is reopened", async () => {
    const { rerender } = render(
      <ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "group.time" }));
    await screen.findByText("metric.flights");
    rerender(<ConsentDialog open={false} person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    rerender(<ConsentDialog open person={person} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "group.time" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await screen.findByText("metric.flights");
  });
});
