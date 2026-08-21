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
// The log fetches on mount — render a marker that reports the reload key it
// was handed, so a missed refresh signal is visible instead of silent.
vi.mock("../../import/ImportLogSection", () => ({
  ImportLogSection: ({ reloadKey }: { reloadKey?: unknown }) => (
    <div data-testid="import-log">{String(reloadKey)}</div>
  ),
}));
vi.unmock("../../../store/settingsStore");

import ImportSection from "../ImportSection";

// Tiles link out (the FR24 help page, the area itself), so the component needs
// a router in scope.
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

  it("does not render a section for a domain that is switched off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    render(<ImportSection />);
    expect(screen.queryByText("common:domain.cruise")).toBeNull();
  });
});

/**
 * The page carries LISTS only. The e-mail/PDF route was here once — #238 read
 * its absence as a gap — and the decision went the other way: a booking mail
 * arrives again and again and belongs in the add-dialog of its area, while a
 * list is a one-off migration. Two acts, two places.
 *
 * This is a test on a DECISION, not on markup: if an e-mail route reappears
 * here, the two surfaces have started to blur again.
 */
describe("ImportSection — lists only", () => {
  it("offers no e-mail/PDF route for any enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise", "lodging"] });
    render(<ImportSection />);
    expect(screen.queryByTestId("import-tile-parse")).toBeNull();
  });

  it("says so plainly for an area that has no list format yet", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"] });
    render(<ImportSection />);
    expect(screen.getByText("settings:import.noRoutes")).toBeTruthy();
  });
});

/**
 * Silent trip auto-creation is import behaviour, so its switch lives on the
 * import hub (board item trip-auto-creation-not-switchable). The toggle
 * persists immediately through the store's setter — no save button.
 */
describe("ImportSection — auto-trip toggle", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], autoCreateTrips: true });
  });

  it("renders the toggle checked when autoCreateTrips is on", () => {
    render(<ImportSection />);
    const toggle = screen.getByLabelText(
      "settings:import.autoCreateTrips.label"
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("clicking the toggle flips the store setting", async () => {
    const user = userEvent.setup();
    render(<ImportSection />);

    await user.click(screen.getByLabelText("settings:import.autoCreateTrips.label"));

    expect(useSettingsStore.getState().autoCreateTrips).toBe(false);
  });
});
