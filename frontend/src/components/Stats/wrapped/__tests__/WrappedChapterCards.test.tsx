import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import WrappedChapterCards from "../WrappedChapterCards";
import type { WrappedChapters } from "../../../../types/wrapped";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { evidenceOpenedBy } from "../../__tests__/evidenceKeysOpened";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";

/**
 * forgejo#265 review I4 — a bus chapter whose rides carry no distance says
 * so; it never reads "0 km mit dem Bus". And every chapter number opens the
 * rows it counted, for the one year on screen.
 */
const NONE: WrappedChapters = {
  lodging: null,
  places: null,
  roadtrips: null,
  tours: null,
  rentals: null,
  bus: null,
};
const ALL: WrappedChapters = {
  lodging: { stays: 2, nights: 5, nightsUnknown: 0 },
  places: { visits: 3, places: 2 },
  roadtrips: { roadtrips: 1 },
  tours: { tours: 4 },
  rentals: { rentals: 1, days: 3 },
  bus: { rides: 2, km: 400, unmeasured: 0, nights: 1 },
};
const count = (n: number): string => String(n);

const draw = (chapters: WrappedChapters) =>
  render(
    <MemoryRouter>
      <WrappedChapterCards chapters={chapters} count={count} year={2025} />
    </MemoryRouter>
  );

describe("WrappedChapterCards — bus kilometres", () => {
  it("says the distance was not recorded instead of 0 km", () => {
    draw({ ...NONE, bus: { rides: 2, km: null, unmeasured: 2, nights: 0 } });
    expect(screen.getByText("stats:wrapped.chapters.busNoKm")).toBeInTheDocument();
    expect(screen.queryByText(/busDesc/)).toBeNull();
  });

  it("names the rides a known total leaves out", () => {
    draw({ ...NONE, bus: { rides: 3, km: 500, unmeasured: 1, nights: 1 } });
    expect(
      screen.getByText(
        "stats:wrapped.chapters.busDesc · stats:wrapped.chapters.busUnmeasured · stats:wrapped.chapters.busNights"
      )
    ).toBeInTheDocument();
  });
});

describe("WrappedChapterCards — counting help and evidence (forgejo#265)", () => {
  it("opens each chapter's rows, scoped to the year in review, from served measures", async () => {
    const { opened, container } = await evidenceOpenedBy(
      <WrappedChapterCards chapters={ALL} count={count} year={2025} />
    );
    expect(opened.map((o) => o.key).sort()).toEqual(
      [
        "wrappedStayCount",
        "wrappedPlaceVisitCount",
        "wrappedRoadtripCount",
        "wrappedTourCount",
        "wrappedRentalCount",
        "wrappedBusRideCount",
      ].sort()
    );
    for (const o of opened) {
      expect(o.scope).toEqual({ period: "year", year: 2025 });
      expect([o.key, EVIDENCE_MEASURES[o.key]?.servedIn]).toEqual([o.key, 1]);
    }
    expectNoNestedTriggers(container);
  });

  it("explains only the chapters it draws — a hidden domain has no card and no help", () => {
    draw({ ...NONE, rentals: { rentals: 1, days: 3 } });
    const help = screen.getByTestId("wrapped-chapters-help");
    expect(help.textContent).toContain("stats:wrapped.help.rentals.unit");
    expect(help.textContent).not.toContain("stats:wrapped.help.bus");
    draw(NONE);
    expect(screen.getAllByTestId("wrapped-chapters-help")).toHaveLength(1);
  });
});
