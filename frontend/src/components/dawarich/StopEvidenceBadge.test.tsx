import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

import StopEvidenceBadge from "./StopEvidenceBadge";
import { stopEvidenceView } from "../../lib/stopEvidenceView";

describe("StopEvidenceBadge", () => {
  it("a stop with a plugin suggestion shows the plugin and its note, a meter and the why line", () => {
    render(
      <StopEvidenceBadge
        view={stopEvidenceView({
          visit: { distanceM: 38, durationMs: 52 * 60_000, venue: { name: "X" } },
          plugins: [
            { pluginName: "Projektarchiv", name: "MSA Küche", note: "Kunde", distanceM: 90 },
          ],
        })}
      />
    );
    expect(screen.getByTestId("stop-evidence-source")).toHaveTextContent("Kunde · Projektarchiv");
    expect(screen.getByTestId("stop-evidence-source")).toHaveAttribute("data-kind", "plugin");
    expect(screen.getByTestId("stop-evidence-meter")).toHaveAttribute("data-level", "high");
    expect(screen.getByTestId("stop-evidence-why")).toHaveTextContent("Projektarchiv");
    expect(screen.getByTestId("stop-evidence-why")).toHaveTextContent("track:evidence.why.dwell");
  });

  it("a stop named only by the venue lookup says so", () => {
    render(
      <StopEvidenceBadge
        view={stopEvidenceView({
          visit: { distanceM: 400, durationMs: 600_000, venue: { name: "X" } },
        })}
      />
    );
    expect(screen.getByTestId("stop-evidence-source")).toHaveTextContent("track:evidence.venue");
    expect(screen.getByTestId("stop-evidence-meter")).toHaveAttribute("data-level", "low");
  });

  it("a calendar event shows its title", () => {
    render(<StopEvidenceBadge view={stopEvidenceView({ calendar: { title: "Kundentermin" } })} />);
    expect(screen.getByTestId("stop-evidence-source")).toHaveTextContent("Kundentermin");
  });

  it("no score: the badge only, no meter and no why line; no view: nothing", () => {
    const { rerender } = render(
      <StopEvidenceBadge
        view={stopEvidenceView({ visit: { durationMs: 3_600_000, venue: { name: "X" } } })}
      />
    );
    expect(screen.getByTestId("stop-evidence-source")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-evidence-meter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stop-evidence-why")).not.toBeInTheDocument();
    rerender(<StopEvidenceBadge view={null} />);
    expect(screen.queryByTestId("stop-evidence")).not.toBeInTheDocument();
  });
});
