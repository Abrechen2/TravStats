import { describe, it, expect, beforeEach, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// The tiles do real file/API work — stub them to markers.
vi.mock("../../import/Fr24ImportTile", () => ({
  Fr24ImportTile: () => <div data-testid="tile-fr24" />,
}));
vi.mock("../../import/GenericCsvImportTile", () => ({
  GenericCsvImportTile: () => <div data-testid="tile-csv" />,
}));
// Keeps the `onImported` callback reachable from a test: the hub is the only
// place that can tell the log a fresh import landed.
vi.mock("../../import/LodgingCsvImportTile", () => ({
  LodgingCsvImportTile: ({ onImported }: { onImported?: () => void }) => (
    <button data-testid="tile-lodging-csv" onClick={() => onImported?.()} />
  ),
}));
// Exposes the tile's `onImported` so a test can fire it — the parse flow
// itself (drop file → parse → review → commit) is covered by its own suites.
vi.mock("../../import/ParseImportTile", () => ({
  ParseImportTile: ({ onImported }: { onImported?: () => void }) => (
    <div data-testid="import-tile-parse">
      <button data-testid="parse-imported-probe" onClick={() => onImported?.()} />
    </div>
  ),
}));
// The log fetches on mount — render a marker that reports the reload key it
// was handed, so a missed refresh signal is visible instead of silent.
vi.mock("../../import/ImportLogSection", () => ({
  ImportLogSection: ({ reloadKey }: { reloadKey?: unknown }) => (
    <div data-testid="import-log">{String(reloadKey)}</div>
  ),
}));
vi.unmock("../../../store/settingsStore");

import ImportSection from "../ImportSection";

// The hub links to the flights page for the flight parse route (#238), so the
// component needs a router in scope.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
import { useSettingsStore } from "../../../store/settingsStore";

describe("ImportSection — central import hub", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("renders the flight group with exactly the two live tiles", () => {
    render(<ImportSection />);
    expect(screen.getByText("common:domain.flight")).toBeTruthy();
    expect(screen.getByTestId("tile-fr24")).toBeTruthy();
    expect(screen.getByTestId("tile-csv")).toBeTruthy();
  });

  it("renders no round-trip tile", () => {
    render(<ImportSection />);
    expect(screen.queryByText(/roundTrip|reimport/i)).toBeNull();
  });

  /**
   * REPLACED by #238. This used to assert that a domain without a BULK importer
   * gets no section at all — which is how an instance with cruises switched on
   * found nothing here for them, on a page that promises "bundled per area".
   * An enabled area now always appears, with whatever routes it has.
   */
  it("renders a group for an enabled domain even without a bulk importer (cruise)", () => {
    render(<ImportSection />);
    expect(screen.getByText("common:domain.cruise")).toBeTruthy();
  });

  it("hides the flight group when the flight domain is disabled", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"] });
    render(<ImportSection />);
    expect(screen.queryByTestId("tile-fr24")).toBeNull();
    expect(screen.queryByText("common:domain.flight")).toBeNull();
  });

  // The lodging CSV importer used to live on the Unterkünfte list page, which
  // contradicted the rule this hub exists to enforce: bulk import is central,
  // domain pages only link here. It moved on the main→dev/hotels merge.
  it("renders the lodging group with its CSV tile", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "lodging"] });
    render(<ImportSection />);
    expect(screen.getByText("common:domain.lodging")).toBeTruthy();
    expect(screen.getByTestId("tile-lodging-csv")).toBeTruthy();
  });

  it("hides the lodging group when the lodging domain is disabled", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    render(<ImportSection />);
    expect(screen.queryByTestId("tile-lodging-csv")).toBeNull();
    expect(screen.queryByText("common:domain.lodging")).toBeNull();
  });
});

/**
 * The log and the importers now sit on the SAME page. A commit therefore has
 * to reach the log, which only fetches on mount — without this signal the
 * hub showed a fresh import under a log still reading "no imports yet"
 * (found in the browser, with every unit test green).
 */
describe("ImportSection — the log learns about a fresh import", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "lodging"] });
  });

  it("renders the import log", () => {
    render(<ImportSection />);
    expect(screen.getByTestId("import-log")).toBeTruthy();
  });

  it("bumps the log's reload key when a lodging import commits", async () => {
    const user = userEvent.setup();
    render(<ImportSection />);
    const before = screen.getByTestId("import-log").textContent;

    await user.click(screen.getByTestId("tile-lodging-csv"));

    expect(screen.getByTestId("import-log").textContent).not.toBe(before);
  });
});

/**
 * #238: the hub calls itself "pro Bereich gebündelt" and then showed neither a
 * section for an enabled domain without a bulk importer (cruises), nor the
 * e-mail/PDF route at all — which is the PRIMARY way most bookings arrive. A
 * user who follows the pointer here still had to know it lives somewhere else.
 */
describe("ImportSection — every enabled domain, every route (#238)", () => {
  it("renders a section for an enabled domain that has no bulk importer (cruise)", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    render(<ImportSection />);
    expect(screen.getByText("common:domain.cruise")).toBeTruthy();
  });

  it("offers the e-mail/PDF route for every enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise", "lodging"] });
    render(<ImportSection />);
    expect(screen.getAllByTestId("import-tile-parse")).toHaveLength(3);
  });

  it("does not offer a route for a domain that is switched off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    render(<ImportSection />);
    expect(screen.queryByText("common:domain.cruise")).toBeNull();
    expect(screen.getAllByTestId("import-tile-parse")).toHaveLength(1);
  });
});

/**
 * The parse route writes an import batch for lodging, so it has to reach the
 * log exactly like the CSV route does. This was wrong once already on the CSV
 * tile, and the new parse tile reintroduced it — hence a test on the WIRING,
 * not just on the rendering.
 */
describe("ImportSection — a parse import reaches the log too", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["lodging"] });
  });

  it("bumps the log's reload key when the lodging e-mail/PDF route creates something", async () => {
    const user = userEvent.setup();
    render(<ImportSection />);
    const before = screen.getByTestId("import-log").textContent;

    await user.click(screen.getByTestId("parse-imported-probe"));

    expect(screen.getByTestId("import-log").textContent).not.toBe(before);
  });
});
