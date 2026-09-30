import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import FlightReportActions from "../FlightReportActions";

/**
 * Tester 2026-09-26 (beta.16, statistics → Flüge): "Zertifikat erstellen"
 * and "PDF Jahresbericht" touched each other — two amber blocks with no gap,
 * each styled on its own. They are one group of report actions now, drawn
 * with the design-system buttons and spaced like every other action bar.
 */
describe("FlightReportActions", () => {
  const renderIt = (): void => {
    render(
      <FlightReportActions
        onGenerateCertificate={vi.fn()}
        onYearReport={vi.fn()}
        generatingPdf={false}
        yearReportDisabled={false}
      />
    );
  };

  it("groups the two report buttons with a gap between them", () => {
    renderIt();
    const group = screen.getByRole("group", { name: "stats:reportActions.label" });
    expect(group.className).toMatch(/\bgap-3\b/);
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining("stats:certificate.generate"),
      "stats:yearReport.btn",
    ]);
  });

  it("draws one primary and one secondary action, not two identical amber blocks", () => {
    renderIt();
    const certificate = screen.getByRole("button", { name: /stats:certificate.generate/ });
    const report = screen.getByRole("button", { name: "stats:yearReport.btn" });
    expect(certificate).toHaveAttribute("data-variant", "primary");
    expect(report).toHaveAttribute("data-variant", "secondary");
  });
});
