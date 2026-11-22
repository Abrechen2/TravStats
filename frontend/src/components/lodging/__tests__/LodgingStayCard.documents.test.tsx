/**
 * Owner, 2026-11-22: a lodging's documents belong to a STAY, not the house. Each stay card
 * carries its own documents, filed against that stay, and no house-level section exists.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { LodgingStay } from "../../../types/lodging";

const mounted = vi.hoisted(() => [] as { type: string; id: string }[]);
vi.mock("../../documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => {
    mounted.push(entry);
    return <div data-testid={`documents-${entry.id}`} />;
  },
}));

import { LodgingStayCard } from "../LodgingStayCard";

const stay = (id: string): LodgingStay =>
  ({
    id,
    lodgingId: "l1",
    checkIn: "2024-06-01T00:00:00.000Z",
    checkOut: "2024-06-05T00:00:00.000Z",
    datePrecision: "DAY",
    checkInTime: null,
    checkOutTime: null,
    nights: null,
    status: "completed",
    board: "none",
    currency: "EUR",
  }) as unknown as LodgingStay;

describe("LodgingStayCard documents", () => {
  it("files each stay card's documents against its own stay, never the lodging", () => {
    mounted.length = 0;
    render(
      <>
        <LodgingStayCard stay={stay("s1")} />
        <LodgingStayCard stay={stay("s2")} />
      </>
    );
    expect(mounted).toEqual([
      { type: "lodgingStay", id: "s1" },
      { type: "lodgingStay", id: "s2" },
    ]);
    expect(screen.getByTestId("documents-s2")).toBeInTheDocument();
  });
});
