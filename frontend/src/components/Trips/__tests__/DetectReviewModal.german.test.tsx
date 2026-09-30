import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DetectReviewModal from "../DetectReviewModal";
import type { ProposedTrip } from "../../../lib/api/trips";

/**
 * Browser acceptance 2026-09-26: the German review dialog showed the chip
 * "HOME-LOOP", "15 Flüge" hard-coded, and spans as "2021-01-15 – 2021-11-07".
 * Rendered through the real German i18next and the DD.MM.YYYY setting.
 */

vi.mock("../../../lib/api", () => ({ tripsApi: { detect: vi.fn() } }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

const proposal: ProposedTrip = {
  source: "home_loop",
  flightIds: ["f1"],
  pnr: null,
  origin: "MUC",
  destination: "BKK",
  span: { from: "2021-01-15", to: "2021-11-07" },
  suggestedName: "MUC ↺ BKK",
  legs: [
    { date: "2021-01-15", flightNumber: "TG925", depIata: "MUC", arrIata: "BKK", status: "flown" },
  ],
};

describe("DetectReviewModal in German", () => {
  it("names the detection in German and formats the days", async () => {
    render(<DetectReviewModal proposals={[proposal]} onClose={vi.fn()} onCommitted={vi.fn()} />);

    expect(screen.getByTestId("detect-source-chip")).toHaveTextContent("von zu Hause und zurück");
    expect(screen.queryByText(/home.?loop/i)).toBeNull();
    expect(screen.getByText("1 Flug")).toBeTruthy();
    expect(screen.getByText(/15\.01\.2021 – 07\.11\.2021/)).toBeTruthy();
    expect(screen.queryByText(/2021-01-15/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Flüge anzeigen" }));
    expect(screen.getByText("15.01.2021")).toBeTruthy();
  });
});
