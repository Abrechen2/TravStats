import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareRows from "../CompareRows";
import ComparePodium from "../ComparePodium";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length ? `${k}|${Object.values(o).join("|")}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colors: {}, colorOf: () => "rgb(1, 2, 3)" }),
}));

const row = (
  key: string,
  metrics: Record<string, number | null>,
  kind = "local"
): LeaderboardRow => ({
  person: { key, kind: kind as "self", username: key, displayName: key, origin: null },
  status: "ok",
  sharedYear: null,
  snapshot: {
    schema: "travstats-leaderboard",
    version: 2,
    asOf: "2026-11-25T08:30:00.000Z",
    year: null,
    domains: ["flight", "poi"],
    metrics,
    partial: [],
  },
});
const show = (self: LeaderboardRow, friend: LeaderboardRow) =>
  render(
    <CompareRows
      self={self}
      friend={{ name: "Norbert", row: friend }}
      year={null}
      domains={null}
      isEnabled={(d) => d === "flight" || d === "poi"}
      iShare
      theyShare={false}
    />
  );

describe("compare extras", () => {
  it("shows curated progress as counts with bars and a lead line", () => {
    show(
      row("self", { curatedWorldHeritage: 23, curatedWorldHeritageOf: 1199 }, "self"),
      row("n", { curatedWorldHeritage: 41, curatedWorldHeritageOf: 1199 })
    );
    expect(screen.getByTestId("curated-curatedWorldHeritage-you").textContent).toContain(
      "23|1.199"
    );
    expect(screen.getByTestId("curated-lead-curatedWorldHeritage").textContent).toContain("18");
    expect(screen.getByTestId("curated-bar-curatedWorldHeritage-them").style.width).toMatch(
      /^3\.4/
    );
  });

  it("an old peer without the curated family shows an em dash, not 0", () => {
    show(
      row("self", { curatedWorldHeritage: 23, curatedWorldHeritageOf: 1199 }, "self"),
      row("n", { flights: 3 })
    );
    expect(screen.getByTestId("curated-curatedWorldHeritage-them").textContent).toBe("—");
    expect(screen.getByTestId("curated-bar-curatedWorldHeritage-them").style.width).toBe("0%");
  });

  it("no curated section for a friend and a reader that have no curated totals at all", () => {
    show(row("self", { flights: 1 }, "self"), row("n", { flights: 2 }));
    expect(screen.queryByTestId("compare-curated")).toBeNull();
  });

  it("fun stats are null-safe: a friend without flight totals gets dashes", () => {
    show(row("self", { flightKm: 40075 }, "self"), row("n", {}));
    expect(screen.getByTestId("fun-you-earth").textContent).toContain("fun.earth");
    expect(screen.getByTestId("fun-them-earth").textContent).toBe("—");
  });

  it("names the last sync and the consent state of both directions", () => {
    show(row("self", {}, "self"), row("n", {}));
    const meta = screen.getByTestId("friend-meta").textContent ?? "";
    expect(meta).toContain("meta.asOf");
    expect(meta).toContain("meta.yes");
    expect(meta).toContain("meta.no");
  });

  it("every drawn metric row carries a Wie-gezählt help", () => {
    show(row("self", { flightKm: 5 }, "self"), row("n", { flightKm: 4 }));
    expect(screen.getByTestId("how-counted-flightKm")).toBeInTheDocument();
  });

  it("podium needs three participants and puts the leader first", () => {
    const rows = [
      row("self", { countries: 5 }, "self"),
      row("a", { countries: 12 }),
      row("b", { countries: 9 }),
    ];
    const { rerender } = render(<ComparePodium rows={rows} year={null} />);
    expect(screen.getByTestId("podium-1").textContent).toContain("a");
    expect(screen.getByTestId("podium-3").textContent).toContain("compare.you");
    rerender(<ComparePodium rows={rows.slice(0, 2)} year={null} />);
    expect(screen.queryByTestId("compare-podium")).toBeNull();
  });
});

describe("lower bounds", () => {
  it("a partial total is left out of the radar and the rivalry lines", () => {
    const partialRow = row("n", { countries: 40, railKm: 100 });
    partialRow.snapshot!.partial = ["countries", "railKm"];
    show(row("self", { countries: 5, railKm: 50 }, "self"), partialRow);
    expect(screen.queryByTestId("rivalry-countries")).toBeNull();
  });
});

describe("yearly totals are drawn only when both sides opted in", () => {
  const years = { "2022": { flightKm: 100 }, "2024": { flightKm: 300 } };
  const withYears = (r: LeaderboardRow, y: typeof years | null, version: 2 | 3 = 3) => {
    if (r.snapshot) {
      r.snapshot.version = version;
      if (y) r.snapshot.years = y;
    }
    return r;
  };
  const go = (iShareYears: boolean | undefined, theirs: typeof years | null, version: 2 | 3 = 3) =>
    render(
      <CompareRows
        self={withYears(row("self", { flightKm: 400 }, "self"), years)}
        friend={{ name: "Norbert", row: withYears(row("n", { flightKm: 300 }), theirs, version) }}
        year={null}
        domains={null}
        isEnabled={(d) => d === "flight"}
        iShareYears={iShareYears}
      />
    );
  it("both sides: a sparkline per metric, no hint", () => {
    go(true, years);
    expect(screen.getAllByTestId("sparkline").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("years-hint")).toBeNull();
  });
  it("only the friend opted in: no sparkline, a hint to switch on one's own", () => {
    go(false, years);
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.getByTestId("years-hint").textContent).toContain("years.youNot");
  });
  it("only the reader opted in: no sparkline, a hint that the friend has not shared", () => {
    go(true, null);
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.getByTestId("years-hint").textContent).toContain("years.theyNot");
  });
  it("an old peer (v2): nothing at all, not even a hint", () => {
    go(true, null, 2);
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.queryByTestId("years-hint")).toBeNull();
  });
});
