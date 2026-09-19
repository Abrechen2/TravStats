import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EvidenceEntryRow from "../EvidenceEntryRow";
import type { EvidenceEntry } from "../../../shared/evidence";

afterEach(cleanup);

/**
 * The global `react-i18next` mock (setup.ts) returns the raw key and drops
 * every option, which hides whether values were actually threaded through.
 * This local override keeps the key visible AND appends the options, so a
 * test can assert on the composed text rather than just "some string
 * rendered" — the same override pattern `DomainTabStrip.test.tsx` uses.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      const { ns: _ns, keySeparator: _ks, ...values } = options;
      return Object.keys(values).length ? `${key}(${JSON.stringify(values)})` : key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

function baseEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    domain: "flight",
    id: "stay-1",
    href: "/lodging/lodging-1",
    title: { text: "Hotel Sport" },
    subtitle: null,
    date: { value: "2026-04-02", precision: "day" },
    ...overrides,
  };
}

function renderRow(entry: EvidenceEntry, aggregation: "sum" | "distinct" = "sum") {
  return render(
    <MemoryRouter>
      <ul>
        <EvidenceEntryRow entry={entry} aggregation={aggregation} />
      </ul>
    </MemoryRouter>
  );
}

describe("EvidenceEntryRow", () => {
  it("links to `href`, NOT `id` — a stay's id is the stay, its href is the lodging", () => {
    renderRow(baseEntry({ id: "stay-1", href: "/lodging/lodging-1" }));
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/lodging/lodging-1");
    // A naive `href={`/…/${entry.id}`}` would have pointed at the stay, not
    // the lodging — the exact bug this contract field split exists to catch.
    expect(link.getAttribute("href")).not.toContain("stay-1");
  });

  it("renders unlinked when `href` is null — a country proved by a lodging with no stay", () => {
    renderRow(baseEntry({ href: null }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Hotel Sport")).toBeInTheDocument();
  });

  it("renders `{text}` titles verbatim — a hotel's own name is not translatable", () => {
    renderRow(baseEntry({ title: { text: "Hôtel du Léman" } }));
    expect(screen.getByText("Hôtel du Léman")).toBeInTheDocument();
  });

  it("composes a `{key, values}` title client-side", () => {
    renderRow(
      baseEntry({
        href: "/flights/f1",
        title: { key: "evidence.ranking.airline", values: { airline: "Lufthansa" } },
      })
    );
    expect(
      screen.getByText('evidence.ranking.airline({"airline":"Lufthansa"})')
    ).toBeInTheDocument();
  });

  it("a `sum` entry renders its contribution, not credits", () => {
    renderRow(baseEntry({ contribution: 612, credits: undefined }), "sum");
    expect(screen.getByText('evidence:entry.contribution({"value":612})')).toBeInTheDocument();
  });

  it("a `distinct` entry renders its credits, not a contribution — the two mean different things", () => {
    renderRow(baseEntry({ contribution: undefined, credits: ["DE", "FR"] }), "distinct");
    expect(screen.getByText('evidence:entry.credits({"list":"DE, FR"})')).toBeInTheDocument();
    expect(screen.queryByText(/entry.contribution/)).not.toBeInTheDocument();
  });

  /**
   * `placesVisitedCount` and `lodgingsUniqueCount` key their union by the
   * entity's id, which is a UUID — so the panel printed
   * "belegt: 0d02459d-4677-…" on the demo account (browser pass, 2026-09-19).
   * The key stays the identity; the LABEL is what reaches the reader.
   */
  it("a UUID-keyed credit renders its NAME, and the UUID never reaches the screen", () => {
    renderRow(
      baseEntry({
        contribution: undefined,
        credits: ["0d02459d-4677-4e0e-9f8e-4d2f0b0a7c11"],
        creditLabels: { "0d02459d-4677-4e0e-9f8e-4d2f0b0a7c11": "Elbphilharmonie" },
      }),
      "distinct"
    );
    expect(
      screen.getByText('evidence:entry.credits({"list":"Elbphilharmonie"})')
    ).toBeInTheDocument();
    expect(screen.queryByText(/0d02459d/)).not.toBeInTheDocument();
  });

  it("a credit with no label renders as itself — 'MUC' and 'DE' are already words", () => {
    renderRow(
      baseEntry({
        contribution: undefined,
        credits: ["DE", "lodging-7"],
        creditLabels: { "lodging-7": "Hotel Sport" },
      }),
      "distinct"
    );
    expect(
      screen.getByText('evidence:entry.credits({"list":"DE, Hotel Sport"})')
    ).toBeInTheDocument();
  });

  it("an undated entry says so rather than looking like a missing date", () => {
    renderRow(baseEntry({ date: null }));
    expect(screen.getByText("evidence:entry.undated")).toBeInTheDocument();
  });
});
