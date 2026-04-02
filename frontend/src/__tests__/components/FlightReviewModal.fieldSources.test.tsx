import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

const noop = async () => {};

const parsedData: ParsedBooking = {
  flightNumber: "LH2460",
  departureCode: "MUC",
  arrivalCode: "HEL",
  missing: [],
  fieldSources: {
    flightNumber: "template",
    departureCode: "template",
    arrivalCode: "llm",
  },
};

vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { feedbackCorrection: vi.fn() },
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("FlightReviewModal fieldSources", () => {
  it("applies green border class for template-sourced flight number field", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={noop as unknown as () => void}
        onConfirm={noop}
        initialData={parsedData}
        source="email"
      />
    );
    const input = screen.getByDisplayValue("LH2460");
    expect(input.className).toMatch(/border-green/);
  });
});
