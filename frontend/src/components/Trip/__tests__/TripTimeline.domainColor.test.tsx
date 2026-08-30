import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { useDomainColorStore } from "../../../store/domainColorStore";
import { DOMAINS } from "../../../shared/domains";

const betaEnabled = { value: false };
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    isFeatureVisible: () => betaEnabled.value,
    betaFeaturesEnabled: betaEnabled.value,
  }),
}));

import TripTimeline from "../TripTimeline";

/**
 * The trip timeline was one of the two surfaces named in #270.
 *
 * It read the fixed brand hex, so a user who painted their flights green still
 * got an amber chip here. What is pinned is not a colour value — it is that the
 * chip follows the SAME source the settings panel writes to. Asserting a
 * literal hex would keep passing after the component went back to reading the
 * brand table.
 */
const events = [
  {
    id: "e1",
    domain: "flight" as const,
    date: "2024-05-01",
    title: "MUC → FCO",
    subtitle: "LH1852",
  },
];

describe("TripTimeline — the chip follows the domain colour", () => {
  beforeEach(() => {
    betaEnabled.value = false;
    useDomainColorStore.getState().resetToBrand();
  });

  it("uses the brand colour while the gate is closed", () => {
    render(<TripTimeline events={events as never} />);

    const badge = screen.getByTestId("timeline-event-badge");
    expect(badge.style.color).toBe(hexToRgbCss(DOMAINS.flight.color));
  });

  it("follows the user's colour once the gate is open", () => {
    betaEnabled.value = true;
    useDomainColorStore.getState().setColor("flight", "#00ff00");

    render(<TripTimeline events={events as never} />);

    const badge = screen.getByTestId("timeline-event-badge");
    expect(badge.style.color).toBe("rgb(0, 255, 0)");
    expect(badge.style.color).not.toBe(hexToRgbCss(DOMAINS.flight.color));
  });
});

/** jsdom reports an inline hex back as `rgb(r, g, b)`. */
function hexToRgbCss(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
