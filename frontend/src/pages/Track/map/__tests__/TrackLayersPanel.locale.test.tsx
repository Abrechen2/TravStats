import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${o.kmh}` : k),
    i18n: { language: "de" },
  }),
}));

import TrackLayersPanel from "../TrackLayersPanel";
import { DEFAULT_PREFS } from "../trackMapPrefs";

describe("TrackLayersPanel speed legend", () => {
  it("writes the scale numbers with the reader's decimal comma, not a dot", () => {
    render(
      <TrackLayersPanel
        prefs={{ ...DEFAULT_PREFS, color: "speed" }}
        onChange={() => undefined}
        long={false}
        speedStops={[{ kmh: 0 }, { kmh: 0.8 }, { kmh: 12.5 }]}
        saveFailed={false}
      />
    );
    const legend = screen.getByTestId("track-speed-legend");
    expect(legend).toHaveTextContent("0,8");
    expect(legend).toHaveTextContent("12,5");
    expect(legend).not.toHaveTextContent("0.8");
  });
});
