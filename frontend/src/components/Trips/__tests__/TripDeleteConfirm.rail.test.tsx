import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * Browser acceptance 2026-09-26: the trip delete dialog listed what survives
 * (flights, cruises, stays, roadtrips) but not rail journeys, which survive
 * too (`RailJourney.trip` is SetNull). Named only where rail is shown at all.
 */

const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));
vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn(async () => []) },
}));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

import TripDeleteConfirm from "../TripDeleteConfirm";

async function renderDialog(): Promise<HTMLElement> {
  render(
    <TripDeleteConfirm isOpen tripId="t1" tripName="Harz" onClose={vi.fn()} onConfirm={vi.fn()} />
  );
  // Let the document count (fetched on open) settle.
  await act(async () => {});
  return screen.getByTestId("confirm-modal");
}

describe("TripDeleteConfirm — rail journeys", () => {
  beforeEach(() => {
    railVisible.value = true;
  });

  it("says rail journeys are kept when rail is shown", async () => {
    expect((await renderDialog()).textContent).toContain(
      "Flüge, Kreuzfahrten, Bahnfahrten, Unterkünfte und Roadtrips bleiben erhalten"
    );
  });

  it("does not mention rail where the domain is hidden", async () => {
    railVisible.value = false;
    const text = (await renderDialog()).textContent ?? "";
    expect(text).toContain("Flüge, Kreuzfahrten, Unterkünfte und Roadtrips bleiben erhalten");
    expect(text).not.toContain("Bahn");
  });
});
