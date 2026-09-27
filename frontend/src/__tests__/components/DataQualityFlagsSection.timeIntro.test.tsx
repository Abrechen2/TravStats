import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagsSection from "../../components/DataQuality/DataQualityFlagsSection";
import { dataQualityFlagsApi } from "../../lib/api/dataQualityFlags";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The inbox's sentence above the time questions (ADR 0002 phase 3b).
 *
 * The section opened with "Bei diesen Einträgen widersprechen sich zwei
 * Angaben" whatever it listed — true for an address in the wrong country,
 * untrue for a flight whose airport has no zone: nothing disagrees there,
 * something is missing. A German reader now sees each group under a sentence
 * that says what its cards are.
 */
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), resolve: vi.fn(), dismiss: vi.fn(), run: vi.fn() },
}));

const toastState = { addToast: vi.fn() };
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const contradiction: DataQualityFlag = {
  id: "flag-1",
  entityType: "lodging",
  entityId: "lodging-1",
  kind: "address_country_mismatch",
  status: "open",
  subject: { entityType: "lodging", entityId: "lodging-1", label: "Hotel Sport" },
  details: {
    claimedCountryCode: "RO",
    claimedCountryText: "Rumänien",
    addressCountryCode: "SI",
    addressCountryText: "Slovenia",
    address: "Grajska cesta 2, Otočec, Slovenia",
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  resolvedAt: null,
};

const timeQuestion: DataQualityFlag = {
  id: "flag-2",
  entityType: "flight",
  entityId: "f1",
  kind: "time_zone_unresolved",
  status: "open",
  subject: {
    entityType: "flight",
    entityId: "f1",
    label: "LH 2462 MUC → CPH",
    parentId: null,
    parentType: null,
    tripId: null,
  },
  details: {
    table: "flights",
    fields: [
      {
        column: "departure",
        reason: "no_position",
        legacyValue: null,
        keptValue: null,
        zone: null,
      },
    ],
  },
  createdAt: "2026-09-27T08:00:00.000Z",
  resolvedAt: null,
};

async function show(flags: DataQualityFlag[]): Promise<void> {
  vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags, count: flags.length });
  render(
    <MemoryRouter>
      <DataQualityFlagsSection />
    </MemoryRouter>
  );
  await screen.findAllByTestId(/^flag-group-/);
}

describe("inbox — the time questions have their own sentence", () => {
  it("does not call a missing zone a contradiction", async () => {
    await show([timeQuestion]);
    expect(screen.getByText(/fehlt uns etwas, um eine Zeit richtig anzuzeigen/)).toBeTruthy();
    expect(screen.queryByText(/widersprechen sich zwei Angaben/)).toBeNull();
  });

  it("keeps the contradiction sentence for contradictions", async () => {
    await show([contradiction]);
    expect(screen.getByText(/widersprechen sich zwei Angaben/)).toBeTruthy();
    expect(screen.queryByText(/Fragen zur Zeit/)).toBeNull();
  });

  it("puts each card under its own heading when both kinds are open", async () => {
    await show([contradiction, timeQuestion]);
    const time = screen.getByTestId("flag-group-time");
    expect(within(time).getByText("Fragen zur Zeit")).toBeTruthy();
    expect(within(time).getByText(/LH 2462/)).toBeTruthy();
    const contradictions = screen.getByTestId("flag-group-contradictions");
    expect(within(contradictions).getByText("Widersprüche")).toBeTruthy();
    expect(within(contradictions).queryByText(/LH 2462/)).toBeNull();
  });
});
