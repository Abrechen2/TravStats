import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import PendingUpdateEditor from "../PendingUpdateEditor";

/**
 * AUD-095 and AUD-096.
 *
 * **095** — a `datetime-local` input carries no timezone, so both directions
 * have to agree on one. The value was rendered from `toISOString()` (UTC) and
 * read back with `new Date(...)`, which reads a bare datetime as the BROWSER's
 * local time. Opening the editor and saving without touching anything moved
 * every time by the browser's offset.
 *
 * **096** — the editor drew its own overlay: no dialog role, no focus
 * handling, no Escape, and labels sitting next to their inputs without being
 * attached to them.
 */

// The house convention for a component test: `t` returns the key, so the
// assertions below match KEYS. That the keys carry real DE and EN copy is the
// i18n parity test's job, not this one's.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

// The preview panel talks to the API; nothing here is about the preview.
vi.mock("../../lib/api", () => ({
  pendingUpdatesApi: { previewImpact: vi.fn().mockResolvedValue({ data: null }) },
}));
vi.mock("../StatisticsImpactPreview", () => ({
  default: () => <div data-testid="impact-preview" />,
}));

const UPDATE = {
  id: "pu-1",
  originalData: {},
  proposedData: {
    airline: "Lufthansa",
    departureTime: "2025-06-01T08:00:00.000Z",
    arrivalTime: "2025-06-01T10:00:00.000Z",
  },
};

describe("PendingUpdateEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the times it was given when nothing is edited (AUD-095)", () => {
    const onSave = vi.fn();
    render(<PendingUpdateEditor update={UPDATE} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "pendingUpdates:editor.save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    // A round trip through the field must be the identity. Before the fix the
    // two ends disagreed about the zone and this shifted by the browser offset
    // — invisibly, and differently on every machine.
    expect(saved.departureTime).toBe("2025-06-01T08:00:00.000Z");
    expect(saved.arrivalTime).toBe("2025-06-01T10:00:00.000Z");
  });

  it("reads a typed time as UTC, the zone it displays (AUD-095)", () => {
    const onSave = vi.fn();
    render(<PendingUpdateEditor update={UPDATE} onSave={onSave} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/editor\.departureTime/);
    fireEvent.change(input, { target: { value: "2025-06-01T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "pendingUpdates:editor.save" }));

    expect(onSave.mock.calls[0][0].departureTime).toBe("2025-06-01T09:30:00.000Z");
  });

  it("shows the zone the times are in, so they can be checked", () => {
    render(<PendingUpdateEditor update={UPDATE} onSave={vi.fn()} onCancel={vi.fn()} />);
    // A time field whose zone the user cannot see is one they cannot verify.
    expect(screen.getAllByText("pendingUpdates:editor.utcSuffix").length).toBe(2);
  });

  it("is a real dialog, and every field has a label attached to it (AUD-096)", () => {
    render(<PendingUpdateEditor update={UPDATE} onSave={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // `getByLabelText` only finds an input its label actually points at, which
    // is the whole assertion: these were adjacent, not associated.
    for (const label of [
      /editor\.airline/,
      /editor\.gate/,
      /editor\.departureTime/,
      /editor\.arrivalTime/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("closes on Escape", () => {
    const onCancel = vi.fn();
    render(<PendingUpdateEditor update={UPDATE} onSave={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalled();
  });
});
