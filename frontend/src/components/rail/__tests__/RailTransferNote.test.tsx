import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const update = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: { update: (...a: unknown[]) => update(...a) },
}));

import { RailTransferNote } from "../RailTransferNote";
import type { RailTransfer } from "../../../lib/rail/railTransfer";

/** forgejo#234 — what a user reads between two legs, and the "knapp" mark. */
const arriving = { id: "j1", arrStationName: "Paris Est", tightConnection: false };
const departing = { depStationName: "Paris Gare de Lyon" };

function note(transfer: RailTransfer, stored: boolean): React.JSX.Element {
  return (
    <RailTransferNote
      transfer={transfer}
      arriving={{ ...arriving, tightConnection: stored }}
      departing={departing}
      index={1}
    />
  );
}

function renderNote(transfer: RailTransfer, stored = false): ReturnType<typeof render> {
  return render(note(transfer, stored));
}

describe("RailTransferNote", () => {
  beforeEach(() => update.mockReset());

  it("names the wait at the station", () => {
    renderNote({ kind: "transfer", minutes: 25, station: { kind: "same" }, shortHint: false });
    const note = screen.getByTestId("rail-transfer-1");
    expect(note).toHaveTextContent('rail:transfer.wait {"station":"Paris Est"');
    expect(note).toHaveTextContent('rail:detail.durationM {\\"m\\":25}');
    expect(screen.queryByTestId("rail-transfer-1-hint")).toBeNull();
    expect(screen.queryByTestId("rail-transfer-1-station-change")).toBeNull();
  });

  it("says a short wait as a hint, never as a promise", () => {
    renderNote({ kind: "transfer", minutes: 6, station: { kind: "same" }, shortHint: true });
    expect(screen.getByTestId("rail-transfer-1-hint")).toHaveTextContent(
      'rail:transfer.shortHint {"minutes":10}'
    );
  });

  it("says a change of stations by both names and the straight-line distance", () => {
    renderNote({
      kind: "transfer",
      minutes: 70,
      station: { kind: "change", meters: 2630 },
      shortHint: false,
    });
    expect(screen.getByTestId("rail-transfer-1-station-change")).toHaveTextContent(
      'rail:transfer.stationChange {"from":"Paris Est","to":"Paris Gare de Lyon","distance":"rail:transfer.distanceKm {\\"value\\":\\"2,6\\"}"}'
    );
  });

  // Ruling 2026-10-08: Paris Est → Paris Nord is a change, with its distance.
  it("rounds a short walk to 50 m steps, as an estimate", () => {
    renderNote({
      kind: "transfer",
      minutes: 30,
      station: { kind: "change", meters: 534 },
      shortHint: false,
    });
    expect(screen.getByTestId("rail-transfer-1-station-change")).toHaveTextContent(
      'rail:transfer.distanceM {\\"value\\":550}'
    );
  });

  it("says another name without a position as unconfirmed, never as a change", () => {
    renderNote({
      kind: "transfer",
      minutes: 30,
      station: { kind: "unconfirmed" },
      shortHint: false,
    });
    expect(screen.getByTestId("rail-transfer-1-station-unconfirmed")).toHaveTextContent(
      "rail:transfer.stationUnconfirmed"
    );
    expect(screen.queryByTestId("rail-transfer-1-station-change")).toBeNull();
  });

  it("shows a departure before the arrival as a conflict with the overlap, not as 0", () => {
    renderNote({ kind: "conflict", minutes: -12, station: { kind: "same" } });
    const note = screen.getByTestId("rail-transfer-1");
    expect(note).toHaveAttribute("data-kind", "conflict");
    expect(note).toHaveTextContent("rail:transfer.conflict");
    expect(note).toHaveTextContent('rail:detail.durationM {\\"m\\":12}');
  });

  it("says an unknown wait as unknown, and still says what is known of the station", () => {
    renderNote({ kind: "unknown", reason: "time", station: { kind: "unconfirmed" } });
    const note = screen.getByTestId("rail-transfer-1");
    expect(note).toHaveTextContent("rail:transfer.unknown");
    expect(note).toHaveTextContent("rail:transfer.unknownWhy");
    expect(note).not.toHaveTextContent("durationM");
    expect(screen.getByTestId("rail-transfer-1-station-unconfirmed")).toBeInTheDocument();
  });

  it("draws another ride as a divider without a mark to set", () => {
    renderNote({ kind: "separate" });
    expect(screen.getByTestId("rail-transfer-1")).toHaveTextContent("rail:transfer.separate");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("saves the mark on the arriving leg and shows the stored value", async () => {
    update.mockResolvedValue({ journey: { id: "j1", tightConnection: true }, geometry: null });
    renderNote({ kind: "transfer", minutes: 25, station: { kind: "same" }, shortHint: false });
    const box = screen.getByRole("checkbox", { name: "rail:transfer.markTight" });
    fireEvent.click(box);
    expect(box).toBeDisabled();
    await waitFor(() => expect(box).toBeChecked());
    expect(update).toHaveBeenCalledWith("j1", { tightConnection: true });
  });

  it("keeps the stored mark and says so when saving it fails", async () => {
    update.mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" });
    renderNote(
      { kind: "transfer", minutes: 25, station: { kind: "same" }, shortHint: false },
      true
    );
    const box = screen.getByRole("checkbox", { name: "rail:transfer.markTight" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:transfer.markFailed");
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription("rail:transfer.markFailed");
  });

  // Review 2026-10-08, important 1: an unknown order claims nothing at all.
  it("says only that the order is unknown, with no station claim and no mark", () => {
    renderNote({ kind: "unknown", reason: "order" });
    const shown = screen.getByTestId("rail-transfer-1");
    expect(shown).toHaveTextContent("rail:transfer.orderUnknown");
    expect(shown).not.toHaveTextContent("rail:transfer.unknown ");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByTestId("rail-transfer-1-station-change")).toBeNull();
  });

  // Review minor 8: a fresh read of the leg wins over what the box last saw.
  it("follows a newly read mark", () => {
    const transfer: RailTransfer = {
      kind: "transfer",
      minutes: 25,
      station: { kind: "same" },
      shortHint: false,
    };
    const { rerender } = renderNote(transfer, false);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    rerender(note(transfer, true));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
