import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TripRecordingView } from "../../../../lib/api/tripRecording";

vi.mock("../../../../lib/api/tripRecording", () => ({
  tripRecordingApi: { get: vi.fn(), downloadGpx: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
const pointer = vi.hoisted(() => ({ coarse: false }));
vi.mock("../../../../hooks/useCoarsePointer", () => ({ useCoarsePointer: () => pointer.coarse }));

import TripRecordingPanel from "../TripRecordingPanel";

const view = (summary: Partial<TripRecordingView["summary"]>): TripRecordingView => ({
  summary: {
    pointCount: 3,
    jitterDropped: 0,
    firstAt: null,
    lastAt: null,
    devices: [],
    days: [{ date: "2026-05-01", zone: "Asia/Tokyo", precision: "day" }],
    ...summary,
  },
  segments: [],
});

function renderPanel(v: TripRecordingView): void {
  render(
    <TripRecordingPanel
      tripId="trip-1"
      view={v}
      failed={false}
      day={null}
      onDayChange={() => undefined}
      onDeleted={() => undefined}
    />
  );
}

describe("TripRecordingPanel (beta.22 UAT)", () => {
  // The select and the two buttons were ~30 px tall on an iPad: the delete a
  // finger could easily miss sat beside the download.
  it("gives the day select, the download and the delete a 44 px target under a finger", () => {
    pointer.coarse = true;
    try {
      renderPanel(view({ devices: ["phone-1"] }));
      const controls = [
        screen.getByRole("combobox", { name: "trips:recording.dayFilter" }),
        screen.getByRole("button", { name: "trips:recording.downloadGpx" }),
        screen.getByRole("button", { name: "trips:recording.delete" }),
      ];
      for (const control of controls) {
        expect(control.style.minHeight).toBe("var(--ts-size-touch-min)");
      }
    } finally {
      pointer.coarse = false;
    }
  });

  it("keeps the compact controls under a mouse", () => {
    renderPanel(view({ devices: ["phone-1"] }));
    expect(screen.getByRole("button", { name: "trips:recording.delete" }).style.minHeight).toBe("");
  });

  // A recording uploaded from the web read "0 Geräte" — as if nothing sent it.
  it("names an upload without a paired device instead of counting zero devices", () => {
    renderPanel(view({ devices: [], uploadedWithoutDevice: true }));
    const summary = screen.getByTestId("trip-recording-summary").textContent ?? "";
    expect(summary).not.toContain("trips:recording.devices");
    expect(summary).toContain("trips:recording.uploadedWithoutDevice");
  });

  it("counts the paired devices beside such an upload", () => {
    renderPanel(view({ devices: ["phone-1"], uploadedWithoutDevice: true }));
    const summary = screen.getByTestId("trip-recording-summary").textContent ?? "";
    expect(summary).toContain('trips:recording.devices {"count":1}');
    expect(summary).toContain("trips:recording.uploadedWithoutDevice");
  });
});
