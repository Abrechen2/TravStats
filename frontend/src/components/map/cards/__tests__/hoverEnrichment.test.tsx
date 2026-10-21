import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { HoverTooltip, type HoverTooltipApi } from "../HoverTooltip";
import { ENRICH_DELAY_MS, enrichHoverBox } from "../hoverEnrichment";
import { useSettingsStore } from "../../../../store/settingsStore";

vi.unmock("../../../../store/settingsStore");

/**
 * The tooltip's pictures never hold it up (owner, 2026-10-21): it is drawn at
 * once, the logo / picture / station text fill in after, and a miss, a
 * failure or a broken image leaves the tooltip as it was drawn.
 */

const api = vi.hoisted(() => ({
  subject: vi.fn(),
  stop: vi.fn(),
  mark: vi.fn(),
}));
vi.mock("../../../../lib/api/mapDetails", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/mapDetails")>()),
  getSubjectImage: api.subject,
  getStopInfo: api.stop,
}));
vi.mock("../../../../lib/api/operators", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/operators")>()),
  getOperatorMark: api.mark,
}));

const CREDIT = {
  qid: "Q1",
  file: "Color Fantasy.jpg",
  licence: "CC BY-SA 4.0",
  licenceUrl: null,
  artist: "Jane Doe",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Color_Fantasy.jpg",
};

const SUBJECT_HTML =
  '<b>Kiel – Oslo</b><div data-hover-subject data-kind="vessel" data-name="Color Fantasy" data-credit="Bild"></div>';
const STOP_HTML =
  '<b>Kiel</b><div data-hover-stop data-domain="ferry" data-name="Kiel" data-lat="54.3" data-lon="10.1" data-credit="Text: Wikipedia" data-unavailable="Wikipedia ist gerade nicht erreichbar."></div>';

function box(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  api.subject.mockReset();
  api.stop.mockReset();
  api.mark.mockReset();
  useSettingsStore.setState({ openDataEnabled: true });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ENRICH_DELAY_MS + 10);
  });
}

describe("hover enrichment", () => {
  it("fills the picture of the ship, credited", async () => {
    api.subject.mockResolvedValue({ available: true, credit: CREDIT });
    const el = box(SUBJECT_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toContain("/map-details/subject/image?kind=vessel");
    expect(el.textContent).toContain("Bild: CC BY-SA 4.0 · Jane Doe · Wikimedia Commons");
  });

  it("removes a picture that fails to load and keeps the rest", async () => {
    api.subject.mockResolvedValue({ available: true, credit: CREDIT });
    const el = box(SUBJECT_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    el.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("Kiel – Oslo");
  });

  it("leaves the slot empty when there is no picture", async () => {
    api.subject.mockResolvedValue({ available: false, credit: null });
    const el = box(SUBJECT_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    expect(el.querySelector("[data-hover-subject]")?.childElementCount).toBe(0);
  });

  it("fills nothing into a tooltip that moved on", async () => {
    api.subject.mockResolvedValue({ available: true, credit: CREDIT });
    const el = box(SUBJECT_HTML);
    const cancel = enrichHoverBox(el, vi.fn());
    cancel();
    await settle();
    expect(api.subject).not.toHaveBeenCalled();
    expect(el.querySelector("img")).toBeNull();
  });

  it("shows the station's photo and opening sentences", async () => {
    api.stop.mockResolvedValue({
      state: "found",
      summary: {
        title: "Kieler Hafen",
        extract: "Der Kieler Hafen ist ein Hafen.",
        thumbnailUrl: "https://upload.wikimedia.org/k.jpg",
        pageUrl: "https://de.wikipedia.org/wiki/Kieler_Hafen",
        lang: "de",
      },
    });
    const el = box(STOP_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    expect(el.textContent).toContain("Der Kieler Hafen ist ein Hafen.");
    expect(el.textContent).toContain("Text: Wikipedia");
    expect(el.querySelector("img")?.referrerPolicy).toBe("no-referrer");
  });

  it("says so when Wikipedia could not be asked, instead of looking empty", async () => {
    api.stop.mockResolvedValue({ state: "unavailable" });
    const el = box(STOP_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    expect(el.textContent).toContain("Wikipedia ist gerade nicht erreichbar.");
  });

  it("asks nothing while the instance's open-data switch is off", async () => {
    useSettingsStore.setState({ openDataEnabled: false });
    const el = box(STOP_HTML);
    enrichHoverBox(el, vi.fn());
    await settle();
    expect(api.stop).not.toHaveBeenCalled();
  });
});

describe("tooltip with pending pictures", () => {
  it("renders its text at once while the picture is still being looked up", async () => {
    api.subject.mockReturnValue(new Promise(() => undefined));
    const ref = createRef<HoverTooltipApi>();
    render(<HoverTooltip ref={ref} />);
    act(() => ref.current!.show({ html: SUBJECT_HTML, x: 10, y: 10 }));
    expect(screen.getByText("Kiel – Oslo")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("Kiel – Oslo")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps a filled picture while the pointer moves over the same line", async () => {
    api.subject.mockResolvedValue({ available: true, credit: CREDIT });
    const ref = createRef<HoverTooltipApi>();
    render(<HoverTooltip ref={ref} />);
    act(() => ref.current!.show({ html: SUBJECT_HTML, x: 10, y: 10 }));
    await settle();
    act(() => ref.current!.show({ html: SUBJECT_HTML, x: 14, y: 12 }));
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(api.subject).toHaveBeenCalledTimes(1);
  });
});
