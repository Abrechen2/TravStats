/**
 * forgejo#405: the rental form suggests what the user entered before — their
 * own brokers and vehicle classes. (A failed load shows `rental-suggestions-failed`;
 * the hook's failure state is pinned in hooks/__tests__/useEntrySuggestions.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("../../TagInput", () => ({ default: () => null }));
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    create: vi.fn(),
    update: vi.fn(),
    searchStations: vi.fn().mockResolvedValue([]),
    providers: vi.fn().mockResolvedValue([]),
  },
}));
const suggestions = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/entrySuggestions", async (original) => ({
  ...(await original<typeof import("../../../lib/api/entrySuggestions")>()),
  entrySuggestionsApi: { rental: (...a: unknown[]) => suggestions(...a) },
}));

import { RentalFormModal } from "../RentalFormModal";
import { getLabelled } from "../../../__tests__/helpers/namedElement";

describe("RentalFormModal — suggestions from earlier rentals", () => {
  beforeEach(() => suggestions.mockReset());

  it("offers the user's own broker and class, and a click fills the field", async () => {
    suggestions.mockResolvedValue({
      providers: ["Sixt"],
      brokers: ["Check24"],
      vehicleClasses: ["Compact"],
      vehicleExamples: [],
    });
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const chips = await screen.findAllByRole("button", { name: /^common:suggestionChip/ });
    expect(chips.map((c) => c.textContent).sort()).toEqual(["Check24", "Compact"]);
    fireEvent.click(chips.find((c) => c.textContent === "Check24")!);
    expect((getLabelled(/^rental:form\.broker/) as HTMLInputElement).value).toBe("Check24");
  });
});
