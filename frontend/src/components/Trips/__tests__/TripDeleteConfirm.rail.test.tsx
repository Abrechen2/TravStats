import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * Browser acceptance 2026-09-26: the trip delete dialog listed what survives
 * (flights, cruises, stays, roadtrips) but not rail journeys, which survive
 * too (`RailJourney.trip` is SetNull). Named only where rail is shown at all.
 * Bus rides and rentals are SetNull as well and are named on the same terms
 * (forgejo#288 sweep).
 */

const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useDomainVisible", () => ({
  useDomainVisible: (key: string): boolean =>
    (
      (
        ({
          rail: () => railVisible.value,
          bus: () => busVisible.value,
          rental: () => rentalVisible.value,
        }) as Record<string, () => boolean>
      )[key] ?? (() => false)
    )(),
}));
const busVisible = vi.hoisted(() => ({ value: false }));
const rentalVisible = vi.hoisted(() => ({ value: false }));
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
    busVisible.value = false;
    rentalVisible.value = false;
  });

  it("names bus rides and rentals where those domains are shown (forgejo#288 sweep)", async () => {
    busVisible.value = true;
    rentalVisible.value = true;
    expect((await renderDialog()).textContent).toContain(
      "Flüge, Kreuzfahrten, Bahnfahrten, Busfahrten, Mietwagen, Unterkünfte und Roadtrips bleiben erhalten"
    );
  });

  it("leaves bus rides out where the bus domain is hidden", async () => {
    expect((await renderDialog()).textContent).not.toContain("Busfahrten");
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
