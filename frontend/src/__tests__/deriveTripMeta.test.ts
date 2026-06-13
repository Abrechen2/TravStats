import { describe, it, expect } from "vitest";
import { deriveTripMeta } from "../components/Cruise/CruiseImportPreviewModal";

// A fly & cruise import auto-creates a Trip. Without an explicit status the
// backend falls back to the Trip Prisma default ("completed"), so an upcoming
// booking would show as "Abgeschlossen". deriveTripMeta derives the status
// from the cruise date span instead.
const entry = (startDate?: string, endDate?: string) => ({
  input: { startDate, endDate } as never,
  flightInputs: [],
  tripLabel: "",
});

const NOW = new Date("2026-06-13T00:00:00.000Z");

describe("deriveTripMeta", () => {
  it("marks a future cruise as planned", () => {
    const meta = deriveTripMeta(
      [entry("2026-06-15T12:00:00.000Z", "2026-06-29T12:00:00.000Z")],
      NOW
    );
    expect(meta.status).toBe("planned");
    expect(meta.startDate).toBe("2026-06-15T12:00:00.000Z");
    expect(meta.endDate).toBe("2026-06-29T12:00:00.000Z");
  });

  it("marks a past cruise as completed", () => {
    const meta = deriveTripMeta(
      [entry("2020-08-11T12:00:00.000Z", "2020-08-19T12:00:00.000Z")],
      NOW
    );
    expect(meta.status).toBe("completed");
  });

  it("marks an in-progress cruise as in_progress", () => {
    const meta = deriveTripMeta(
      [entry("2026-06-10T12:00:00.000Z", "2026-06-20T12:00:00.000Z")],
      NOW
    );
    expect(meta.status).toBe("in_progress");
  });

  it("spans the widest range across multiple cruises", () => {
    const meta = deriveTripMeta(
      [
        entry("2026-06-15T12:00:00.000Z", "2026-06-20T12:00:00.000Z"),
        entry("2026-06-10T12:00:00.000Z", "2026-06-29T12:00:00.000Z"),
      ],
      NOW
    );
    expect(meta.startDate).toBe("2026-06-10T12:00:00.000Z");
    expect(meta.endDate).toBe("2026-06-29T12:00:00.000Z");
    // span includes today → in progress
    expect(meta.status).toBe("in_progress");
  });

  it("defaults to completed when no dates are present", () => {
    const meta = deriveTripMeta([entry(undefined, undefined)], NOW);
    expect(meta.status).toBe("completed");
    expect(meta.startDate).toBeUndefined();
    expect(meta.endDate).toBeUndefined();
  });
});
