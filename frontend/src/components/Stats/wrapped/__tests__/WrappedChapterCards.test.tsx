import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import WrappedChapterCards from "../WrappedChapterCards";
import type { WrappedChapters } from "../../../../types/wrapped";

/**
 * forgejo#265 review I4 — a bus chapter whose rides carry no distance says
 * so; it never reads "0 km mit dem Bus".
 */
const NONE: WrappedChapters = {
  lodging: null,
  places: null,
  roadtrips: null,
  tours: null,
  rentals: null,
  bus: null,
};
const count = (n: number): string => String(n);

describe("WrappedChapterCards — bus kilometres", () => {
  it("says the distance was not recorded instead of 0 km", () => {
    render(
      <WrappedChapterCards
        chapters={{ ...NONE, bus: { rides: 2, km: null, unmeasured: 2, nights: 0 } }}
        count={count}
      />
    );
    expect(screen.getByText("stats:wrapped.chapters.busNoKm")).toBeInTheDocument();
    expect(screen.queryByText(/busDesc/)).toBeNull();
  });

  it("names the rides a known total leaves out", () => {
    render(
      <WrappedChapterCards
        chapters={{ ...NONE, bus: { rides: 3, km: 500, unmeasured: 1, nights: 1 } }}
        count={count}
      />
    );
    expect(
      screen.getByText(
        "stats:wrapped.chapters.busDesc · stats:wrapped.chapters.busUnmeasured · stats:wrapped.chapters.busNights"
      )
    ).toBeInTheDocument();
  });
});
