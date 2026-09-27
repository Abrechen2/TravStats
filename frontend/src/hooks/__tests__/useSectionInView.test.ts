import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSectionInView } from "../useSectionInView";

/**
 * The scroll-spy behind the settings and admin index columns.
 *
 * jsdom neither lays out nor scrolls, so the page is faked: each landmark's
 * `getBoundingClientRect().top` and the document's scroll metrics are stubs,
 * and a scroll event asks the hook again.
 */

const SECTIONS = ["profile", "trips", "loyalty", "about"] as const;

function renderLandmarks(): void {
  document.body.innerHTML = SECTIONS.map((id) => `<section id="settings-${id}"></section>`).join(
    ""
  );
}

/** Places each section's top, in viewport pixels. */
function placeSections(tops: Record<(typeof SECTIONS)[number], number>): void {
  for (const id of SECTIONS) {
    const el = document.getElementById(`settings-${id}`) as HTMLElement;
    el.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
  }
}

function setScrollMetrics(options: {
  scrollHeight: number;
  innerHeight: number;
  scrollY: number;
}): void {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: options.scrollHeight,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: options.innerHeight,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: options.scrollY });
}

const scroll = (): void => {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
};

describe("useSectionInView", () => {
  beforeEach(renderLandmarks);
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // Acceptance 2026-09-26: the index marked "Reisen" while the reader sat in
  // "Bonusprogramme". A short section above still reached the upper third
  // and, first in document order, won.
  it("marks the section whose top has passed the reading line, not a short one still above it", () => {
    setScrollMetrics({ scrollHeight: 5000, innerHeight: 800, scrollY: 1200 });
    // "Reisen" is a short card: its top is off screen, its end just above
    // the jumped-to "Bonusprogramme", whose top sits under the header.
    placeSections({ profile: -900, trips: -60, loyalty: 72, about: 2400 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));
    expect(result.current).toBe("loyalty");

    placeSections({ profile: -900, trips: 40, loyalty: 180, about: 2500 });
    scroll();
    expect(result.current).toBe("trips");
  });

  it("marks the first section before any has reached the reading line", () => {
    setScrollMetrics({ scrollHeight: 5000, innerHeight: 800, scrollY: 0 });
    placeSections({ profile: 120, trips: 900, loyalty: 1400, about: 3000 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));
    expect(result.current).toBe("profile");
  });

  it("marks the last section once the document is scrolled to its end, however short that section is", () => {
    setScrollMetrics({ scrollHeight: 2400, innerHeight: 800, scrollY: 400 });
    placeSections({ profile: -800, trips: -300, loyalty: 50, about: 700 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));
    expect(result.current).toBe("loyalty");

    setScrollMetrics({ scrollHeight: 2400, innerHeight: 800, scrollY: 1600 });
    placeSections({ profile: -2000, trips: -1500, loyalty: -1150, about: 300 });
    scroll();
    expect(result.current).toBe("about");
  });

  it("does not mark the last section on a page that cannot scroll at all", () => {
    setScrollMetrics({ scrollHeight: 600, innerHeight: 800, scrollY: 0 });
    placeSections({ profile: 60, trips: 200, loyalty: 300, about: 400 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));
    scroll();
    expect(result.current).toBe("profile");
  });
});
