import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DawarichStay } from "../../../../lib/api/dawarichStays";
import de from "../../../../i18n/resources/de/trips.json";
import en from "../../../../i18n/resources/en/trips.json";

/**
 * A TravTrack finding whose history went before it was accepted is
 * `invalidated` (TravTrack plan E4). It leaves the inbox, and the history
 * says so instead of letting it vanish.
 */

const list = vi.fn(async (status: string) =>
  status === "invalidated"
    ? [
        {
          id: "stay-invalidated",
          status: "invalidated",
          name: "Seoul stop",
          startAt: "2026-10-10T10:00:00.000Z",
          resolvedAt: "2026-10-12T10:00:00.000Z",
          evidence: {
            source: "travtrack",
            zone: "Asia/Seoul",
            maxGapMinutes: 10,
            uncertainties: [],
          },
        } as unknown as DawarichStay,
      ]
    : []
);
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: (status: string) => list(status) },
}));

import InboxHistory from "../InboxHistory";

describe("InboxHistory — TravTrack findings whose history went", () => {
  it("asks for invalidated findings and names them as such", async () => {
    render(<InboxHistory source="dawarich" />);
    expect(await screen.findByText("Seoul stop")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith("invalidated");
    expect(screen.getByText(/trips:dawarichStays.status.invalidated/)).toBeInTheDocument();
  });

  it("says the evidence no longer holds, not that the history was deleted", () => {
    // An invalidation follows any change that breaks the detector's rules, a
    // deletion being only one of them.
    expect(de.dawarichStays.status.invalidated).toBe("Die Belege dafür gelten nicht mehr");
    expect(en.dawarichStays.status.invalidated).toBe("Its evidence no longer holds");
  });
});
