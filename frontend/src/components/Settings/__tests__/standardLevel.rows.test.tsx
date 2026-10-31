import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import AutoUpdateSection from "../AutoUpdateSection";
import InboxSuggestionsSection from "../InboxSuggestionsSection";
import BackupSection from "../BackupSection";
import { HiddenRowsContext } from "../frame/useExpertRows";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

/**
 * Sections holding standard and expert rows at once (forgejo#321): the
 * standard row stays, the tuning goes, and the section frame is told how many
 * settings it left out so it can say so.
 */
const autoUpdate = {
  enabled: true,
  requireApproval: true,
  checkInterval: 15,
  onlyDuringFlight: true,
  expiryHours: 24,
};

function renderReporting(ui: JSX.Element): ReturnType<typeof vi.fn> {
  const report = vi.fn();
  render(
    <MemoryRouter>
      <HiddenRowsContext.Provider value={report}>{ui}</HiddenRowsContext.Provider>
    </MemoryRouter>
  );
  return report;
}

const lastHidden = (report: ReturnType<typeof vi.fn>): number =>
  report.mock.calls.length ? (report.mock.calls[report.mock.calls.length - 1][1] as number) : -1;

describe("standard level inside a section", () => {
  beforeEach(() => useSettingsLevelStore.setState({ level: "standard" }));

  it("keeps the live-update switch with approval, and hides the expiry", () => {
    const report = renderReporting(
      <AutoUpdateSection
        autoUpdateSettings={autoUpdate}
        loadingAutoUpdateSettings={false}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSetAutoUpdateSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText("settings:autoUpdate.enabled")).toBeInTheDocument();
    expect(screen.getByLabelText("settings:autoUpdate.requireApproval")).toBeInTheDocument();
    expect(screen.queryByLabelText("settings:autoUpdate.onlyDuringFlight")).toBeNull();
    expect(screen.queryByLabelText("settings:autoUpdate.expiryHours")).toBeNull();
    expect(lastHidden(report)).toBe(1);
  });

  it("counts no hidden tuning while live updates are off — there is none to show", () => {
    const report = renderReporting(
      <AutoUpdateSection
        autoUpdateSettings={{ ...autoUpdate, enabled: false }}
        loadingAutoUpdateSettings={false}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSetAutoUpdateSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(lastHidden(report)).toBe(0);
  });

  it("draws the tuning rows at the expert level", () => {
    useSettingsLevelStore.setState({ level: "expert" });
    const report = renderReporting(
      <AutoUpdateSection
        autoUpdateSettings={autoUpdate}
        loadingAutoUpdateSettings={false}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSetAutoUpdateSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText("settings:autoUpdate.expiryHours")).toBeInTheDocument();
    expect(lastHidden(report)).toBe(0);
  });

  it("keeps the trip and stay switches and the two stay refinements — they are consent decisions", () => {
    const report = renderReporting(<InboxSuggestionsSection />);
    expect(screen.getByLabelText("settings:inboxSuggestions.trips.label")).toBeInTheDocument();
    expect(screen.getByLabelText("settings:inboxSuggestions.stays.label")).toBeInTheDocument();
    expect(
      screen.getByLabelText("settings:inboxSuggestions.immichEvidence.label")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("settings:inboxSuggestions.llmPlaceClassification.label")
    ).toBeInTheDocument();
    // Nothing in this section is left to the expert level: it reports none.
    expect(lastHidden(report)).toBe(-1);
  });

  it("keeps the export and hides the instance backup's last run", () => {
    const report = renderReporting(
      <BackupSection lastBackup={null} backupStatus={null} isAdmin={false}>
        <p>export-rows</p>
      </BackupSection>
    );
    expect(screen.getByText("export-rows")).toBeInTheDocument();
    expect(screen.queryByText("settings:backup.lastInstanceBackup")).toBeNull();
    expect(lastHidden(report)).toBe(1);
  });
});
