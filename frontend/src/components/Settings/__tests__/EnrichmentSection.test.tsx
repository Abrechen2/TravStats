import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../EnrichmentCandidatesPanel", () => ({ default: () => null }));

import EnrichmentSection from "../EnrichmentSection";
import { resetWriteQueue, DEBOUNCE_MS } from "../../ui/settings/writeQueue";

const SETTINGS = { enabled: true, minConfidence: 70, maxPerDay: 50 };

function renderSection(onSave = vi.fn().mockResolvedValue(undefined), enabled = true) {
  render(
    <MemoryRouter>
      <EnrichmentSection
        historicalEnrichmentSettings={{ ...SETTINGS, enabled }}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSave={onSave}
      />
    </MemoryRouter>
  );
  return onSave;
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
  });
};

describe("EnrichmentSection", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    resetWriteQueue();
    vi.useRealTimers();
  });

  /** The section wore a "Beta" pill that named no gate (found 2026-09-19). */
  it("wears no Beta badge — there is no gate behind it to justify one", () => {
    renderSection();
    expect(screen.queryByText(/beta/i)).toBeNull();
  });

  it("writes only the changed field, and the number rows exist only while it is on", async () => {
    const onSave = renderSection();
    fireEvent.change(screen.getByLabelText("settings:rows.enrichmentConfidence.name"), {
      target: { value: "80" },
    });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ minConfidence: 80 });
    cleanup();
    renderSection(undefined, false);
    expect(screen.queryByLabelText("settings:rows.enrichmentConfidence.name")).toBeNull();
  });

  it("a refused switch keeps the choice and retries through the row", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue(undefined);
    renderSection(onSave, false);
    const sw = (): HTMLElement =>
      screen.getByRole("switch", { name: "settings:rows.enrichment.name" });
    fireEvent.click(sw());
    await flush();
    expect(sw()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await flush();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("a confidence above 100 is explained, not sent", async () => {
    const onSave = renderSection();
    fireEvent.change(screen.getByLabelText("settings:rows.enrichmentConfidence.name"), {
      target: { value: "150" },
    });
    await flush();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/settings:blocks.number.range/)).toBeInTheDocument();
  });
});
