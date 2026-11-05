import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackStop } from "../../../lib/api/travtrackLegs";

const legsApi = vi.hoisted(() => ({ stopIdentity: vi.fn(), setStopPlace: vi.fn() }));
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
import { clearStopIdentityCache } from "../../../lib/travtrackStopIdentity";

/**
 * A stop folded into a fixed place or a lodging (spec
 * 2026-11-05-travtrack-fixed-places, S3) is named by the server: the row shows
 * the name, where it came from and how many fixes were folded, asks no
 * geocoder, and offers no "take the name back" — it was never accepted.
 */

const folded = (source: "fixed" | "lodging", name: string): TravTrackStop => ({
  fromMs: 1_000_000,
  untilMs: 1_000_000 + 3 * 60 * 60_000,
  anchor: { lat: 52.5, lon: 13.4 },
  stayRef: null,
  place: { name, lat: 52.5, lon: 13.4, source },
  folded: { fixCount: 37 },
});

const renderStop = (s: TravTrackStop) =>
  render(
    <MemoryRouter>
      <TrackLegList
        date="2026-10-25"
        zone="UTC"
        legs={[]}
        stops={[s]}
        selection={null}
        onSelect={() => {}}
      />
    </MemoryRouter>
  );

describe("a folded stop in the day list", () => {
  beforeEach(() => {
    legsApi.stopIdentity.mockReset();
    clearStopIdentityCache();
  });

  it("names a fixed place, says it is one, counts the folded fixes, and looks nothing up", () => {
    renderStop(folded("fixed", "Office"));
    expect(screen.getByTestId("track-stop-place-name").textContent).toContain("Office");
    expect(screen.getByTestId("track-stop-place-source").textContent).toBe(
      "track:stop.place.fixed"
    );
    expect(screen.getByTestId("track-stop-folded").textContent).toContain('"count":37');
    expect(screen.queryByTestId("track-stop-place-remove")).toBeNull();
    expect(legsApi.stopIdentity).not.toHaveBeenCalled();
  });

  it("names a lodging as a lodging", () => {
    renderStop(folded("lodging", "Hotel Mitte"));
    expect(screen.getByTestId("track-stop-place-source").textContent).toBe(
      "track:stop.place.lodging"
    );
  });

  it("keeps the take-back button for an accepted name, folded or not", () => {
    const accepted: TravTrackStop = {
      ...folded("fixed", "x"),
      place: { name: "My desk", lat: null, lon: null, source: "accepted" },
    };
    renderStop(accepted);
    expect(screen.getByTestId("track-stop-place-remove")).toBeTruthy();
    expect(screen.queryByTestId("track-stop-place-source")).toBeNull();
  });
});
