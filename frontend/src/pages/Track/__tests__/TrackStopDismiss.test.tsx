import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackStop } from "../../../lib/api/travtrackLegs";

const legsApi = vi.hoisted(() => ({
  stopIdentity: vi.fn(),
  setStopPlace: vi.fn(),
  setStopDismissed: vi.fn(),
}));
vi.mock("../../../lib/api/travtrackLegs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackLegs")>()),
  travTrackLegsApi: legsApi,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 ? `${key} ${JSON.stringify(o)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackLegList from "../TrackLegList";
import TrackStopCard from "../map/TrackStopCard";
import { clearStopIdentityCache } from "../../../lib/travtrackStopIdentity";

const stop = (over: Partial<TravTrackStop> = {}): TravTrackStop => ({
  fromMs: 1_000_000,
  untilMs: 1_000_000 + 10 * 60_000,
  anchor: { lat: 52.5, lon: 13.4 },
  stayRef: null,
  place: { name: "Ampel", lat: null, lon: null, source: "accepted" },
  ...over,
});
const span = { fromMs: 1_000_000, untilMs: 1_000_000 + 10 * 60_000 };

describe("dismissing a stop that was only a wait", () => {
  beforeEach(() => {
    Object.values(legsApi).forEach((f) => f.mockReset());
    clearStopIdentityCache();
  });

  it("dismisses from the stop card, reads the day again and closes the card", async () => {
    legsApi.setStopDismissed.mockResolvedValue(stop({ dismissed: true }));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <TrackStopCard stop={stop()} zone="UTC" onClose={onClose} onChanged={onChanged} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("track-stop-dismiss"));
    await waitFor(() => expect(legsApi.setStopDismissed).toHaveBeenCalledWith(span, true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it("says why a dismissal failed and keeps the card open", async () => {
    legsApi.setStopDismissed.mockRejectedValue({ response: { status: 500, data: {} } });
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <TrackStopCard stop={stop()} zone="UTC" onClose={onClose} onChanged={async () => {}} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("track-stop-dismiss"));
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.generic");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists a dismissed stop as a hidden wait with a restore, not as a stop", async () => {
    legsApi.setStopDismissed.mockResolvedValue(stop());
    const changed = vi.fn();
    render(
      <MemoryRouter>
        <TrackLegList
          date="2026-10-25"
          zone="UTC"
          legs={[]}
          stops={[stop({ dismissed: true })]}
          selection={null}
          onSelect={() => {}}
          onStopPlaceChanged={changed}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("track-stop-row")).toBeNull();
    expect(screen.getByTestId("track-stop-dismissed")).toBeInTheDocument();
    expect(legsApi.stopIdentity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("track-stop-restore"));
    await waitFor(() => expect(legsApi.setStopDismissed).toHaveBeenCalledWith(span, false));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });
});
