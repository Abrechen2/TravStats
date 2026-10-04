/**
 * A suggestion the paired phone made (forgejo#194) must say so: its source is
 * the evidence the user weighs before applying it, and "Device_gps" — the raw
 * value capitalised, which is what an unknown source fell back to — tells a
 * reader nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../ChangeDiffView", () => ({ default: () => null }));
vi.mock("../PendingUpdateEditor", () => ({ default: () => null }));

import PendingUpdateCard from "../PendingUpdateCard";

describe("PendingUpdateCard — the phone as a source", () => {
  it("names a device_gps suggestion as the phone's", () => {
    render(
      <PendingUpdateCard
        update={{
          id: "u1",
          flightId: "f1",
          status: "pending",
          originalData: {},
          proposedData: { actualArrival: "2026-10-04T05:00:00.000Z" },
          changes: [
            {
              field: "actualArrival",
              type: "added",
              oldValue: null,
              newValue: "2026-10-04T05:00:00.000Z",
            },
          ],
          apiSource: "device_gps",
          fetchedAt: "2026-10-04T05:01:00.000Z",
          expiresAt: "2026-10-05T05:01:00.000Z",
        }}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
      />
    );
    expect(screen.getByText("pendingUpdates:apiSource.deviceGps")).toBeInTheDocument();
    expect(screen.queryByText("Device_gps")).not.toBeInTheDocument();
  });
});
