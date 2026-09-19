import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import * as api from "../../../lib/api";

/**
 * A saved sample is shown as it was saved — review of
 * `fix/workshop-lodging-derivation`, finding 4.
 *
 * Every save writes `filtered`: which version the stored text IS. Nothing read
 * it back, so a sample that had been saved was filtered AGAIN for display —
 * a second pass over an already-filtered document, and `filterEmailText` is
 * not idempotent (its greeting rules are anchored at the start of a line, so
 * one pass can expose a line the next pass then removes). A sample saved
 * deliberately unfiltered lost its headers on screen the same way.
 *
 * The fixtures put a removable line INSIDE the stored text, because that is
 * the only way the second pass is observable from outside.
 */

vi.mock("../../../lib/api", () => ({
  trainingApi: { getById: vi.fn(), annotate: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const GREETING = "Sehr geehrter Herr Muster,";
const STORED = [GREETING, "Unterkunft: Hotel Seeblick Garni"].join("\n");

const sample = (annotations: Record<string, unknown>) => ({
  id: "td1",
  type: "email" as const,
  status: "pending" as const,
  annotations,
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("EmailAnnotation — the version a sample was saved as", () => {
  it("does not filter a saved sample a second time", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      // No marks at all, and no `textSelections` key: `filtered` is the only
      // thing that can tell this apart from a fresh upload.
      sample({ type: "email", fullText: STORED, filtered: true })
    );
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(document.body.textContent).toContain(GREETING);
  });

  it("keeps the headers of a sample saved deliberately unfiltered", async () => {
    const raw = ["From: reservierung@hotel-seeblick.test", "", STORED].join("\n");
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: raw, filtered: false })
    );
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(document.body.textContent).toContain("reservierung@hotel-seeblick.test");
  });

  it("still filters a fresh upload, which was never saved and carries no version", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: STORED })
    );
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(document.body.textContent).not.toContain(GREETING);
  });
});
