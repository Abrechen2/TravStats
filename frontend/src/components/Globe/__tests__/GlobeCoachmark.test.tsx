import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { GlobeCoachmark, GLOBE_COACHMARK_SEEN_KEY } from "../GlobeCoachmark";

beforeEach(() => {
  window.localStorage.clear();
});

describe("GlobeCoachmark", () => {
  // forgejo#88 acceptance, 2026-10-10: on a brand-new account the card sat
  // on top of the dashboard's empty state and hid "Reisen importieren".
  it("stays hidden on an empty globe, and does not count as seen", () => {
    render(<GlobeCoachmark hasContent={false} />);
    expect(screen.queryByText("map:globe.coachmark.title")).toBeNull();
    expect(window.localStorage.getItem(GLOBE_COACHMARK_SEEN_KEY)).toBeNull();
  });

  it("appears once there is content, and a dismissal sticks", () => {
    const { rerender } = render(<GlobeCoachmark hasContent={false} />);
    rerender(<GlobeCoachmark hasContent />);
    expect(screen.getByText("map:globe.coachmark.title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "map:globe.coachmark.dismiss" }));
    expect(screen.queryByText("map:globe.coachmark.title")).toBeNull();
    expect(window.localStorage.getItem(GLOBE_COACHMARK_SEEN_KEY)).toBe("1");
  });

  it("stays away once seen", () => {
    window.localStorage.setItem(GLOBE_COACHMARK_SEEN_KEY, "1");
    render(<GlobeCoachmark hasContent />);
    expect(screen.queryByText("map:globe.coachmark.title")).toBeNull();
  });
});
