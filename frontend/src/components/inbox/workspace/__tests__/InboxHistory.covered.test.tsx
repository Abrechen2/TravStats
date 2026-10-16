import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DawarichStay } from "../../../../lib/api/dawarichStays";

/**
 * A Dawarich stay the user had already recorded leaves the inbox as `covered`
 * (prod, 2026-10-16: 30 of 51 open stays sat on a visit logged live). It must
 * not vanish in silence: the history lists it and names what holds it.
 */

const stay = (status: DawarichStay["status"], extra: Partial<DawarichStay["evidence"]> = {}) =>
  ({
    id: `stay-${status}`,
    status,
    name: "The War Memorial of Korea",
    startAt: "2026-10-05T08:01:46.000Z",
    resolvedAt: "2026-10-16T10:00:00.000Z",
    evidence: {
      source: "dawarich",
      zone: "Asia/Seoul",
      pointIds: [],
      maxGapMinutes: 0,
      uncertainties: [],
      ...extra,
    },
  }) as unknown as DawarichStay;

const list = vi.fn(async (status: string) =>
  status === "covered"
    ? [
        stay("covered", {
          coveredBy: {
            kind: "visit",
            id: "v1",
            placeId: "p1",
            name: "War Memorial",
            distanceM: 60,
          },
        }),
      ]
    : []
);
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: (status: string) => list(status) },
}));

import InboxHistory from "../InboxHistory";

describe("InboxHistory — Dawarich stays already recorded", () => {
  it("asks for covered findings and says which record holds each", async () => {
    render(<InboxHistory source="dawarich" />);
    expect(await screen.findByText("The War Memorial of Korea")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith("covered");
    // The test translator renders keys; the DE/EN copy is held by the parity test.
    expect(screen.getByText(/trips:dawarichStays.coveredBy.visit/)).toBeInTheDocument();
  });
});
