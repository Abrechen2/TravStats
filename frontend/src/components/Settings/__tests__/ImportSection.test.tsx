import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders no group for a domain without bulk importers (cruise)", () => {
    render(<ImportSection />);
    expect(screen.queryByText("common:domain.cruise")).toBeNull();
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
