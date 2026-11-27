import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import TrackRangeBar from "../TrackRangeBar";
import { customSpan } from "../trackSpan";

vi.mock("../../../../components/Dashboard/LastSeenCard", () => ({ LastSeenLine: () => null }));
vi.mock("../../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

describe("TrackRangeBar — the custom range picker", () => {
  it("offers the calendar's quick picks (it passed an empty list and showed none)", () => {
    const today = "2026-11-27";
    render(
      <MemoryRouter>
        <TrackRangeBar
          span={customSpan("2026-11-01", "2026-11-05", today)}
          today={today}
          strip={null}
          onStep={vi.fn()}
          onPreset={vi.fn()}
          onSpan={vi.fn()}
        />
      </MemoryRouter>
    );
    const open = screen.getAllByRole("button", { name: "Kalender öffnen" });
    fireEvent.click(open[open.length - 1]);
    const picks = screen.getByRole("group", { name: "Schnellauswahl" });
    expect(picks).toHaveTextContent("Heute");
    expect(picks).toHaveTextContent("7 Tage");
  });
});
