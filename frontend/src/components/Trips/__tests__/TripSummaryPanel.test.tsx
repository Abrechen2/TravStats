import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TripSummaryPanel, summaryLanguageOf } from "../TripSummaryPanel";
import type { Trip } from "../../../types";

const t = (k: string) => k;
const trip = (summary: string | null) => ({ id: "t1", name: "Köln", summary }) as unknown as Trip;

/**
 * Owner, 2026-11-20: creating a summary is used once per trip and moved into
 * the head's "Mehr" menu (`TripMoreMenu.test.tsx`). The overview card only
 * shows a summary that exists — no call to action, no "no model" notice.
 */
describe("TripSummaryPanel — shows a summary, offers nothing", () => {
  it("shows an existing summary without a create or regenerate control", () => {
    render(<TripSummaryPanel trip={trip("Elf Tage um die Insel.")} t={t} />);
    expect(screen.getByText("Elf Tage um die Insel.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws no card for a trip without a summary (the create call to action moved to the menu)", () => {
    const { container } = render(<TripSummaryPanel trip={trip(null)} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("summaryLanguageOf", () => {
  it("maps any other UI language to German, the app's primary language", () => {
    expect(summaryLanguageOf("fr")).toBe("de");
    expect(summaryLanguageOf("EN")).toBe("en");
    expect(summaryLanguageOf("en-US")).toBe("en");
  });
});
