import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import { marksAlign } from "../../../components/Training/marks";
import * as api from "../../../lib/api";

/**
 * What the annotation view SAVES has to be the text its marks were measured
 * against — beta audit follow-up, 2026-09-19.
 *
 * It saved `filterEmailText(originalEmailText)` whatever was on screen. With
 * the filter switched off, or on a sample being re-opened whose stored text
 * was already filtered once, that is a different document from the one the
 * offsets describe. Nothing failed: the deriver simply read the label of
 * whichever line the shifted offset landed in.
 *
 * The greeting in the fixture is what `filterEmailText` removes, so the two
 * versions really are different lengths — a fixture it leaves alone would let
 * this pass on the broken code.
 */

vi.mock("../../../lib/api", () => ({
  trainingApi: { getById: vi.fn(), annotate: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const STORED_TEXT = [
  "Sehr geehrter Herr Muster,",
  "",
  "Unterkunft: Hotel Seeblick Garni",
  "Anreise: 10. März 2026",
].join("\n");

const markFor = (value: string, label: string) => {
  const start = STORED_TEXT.indexOf(value);
  return { start, end: start + value.length, text: value, label };
};

const STORED_MARKS = [
  markFor("Hotel Seeblick Garni", "hotelName"),
  markFor("10. März 2026", "checkIn"),
];

describe("EmailAnnotation — marks and the text they are saved with", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue({
      id: "td1",
      type: "email" as const,
      status: "pending" as const,
      annotations: { type: "email", fullText: STORED_TEXT, textSelections: STORED_MARKS },
      extractedData: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({ success: true });
  });

  it("saves the text the marks point into, not a re-filtered copy of it", async () => {
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    await userEvent.click(screen.getByText("training:annotation.saveOnly"));

    await waitFor(() => expect(api.trainingApi.annotate).toHaveBeenCalled());
    const [, annotations] = vi.mocked(api.trainingApi.annotate).mock.calls[0];
    const saved = annotations as { fullText: string; textSelections: typeof STORED_MARKS };
    expect(saved.fullText).toBe(STORED_TEXT);
    expect(marksAlign(saved.fullText, saved.textSelections)).toBe(true);
    for (const mark of saved.textSelections) {
      expect(saved.fullText.slice(mark.start, mark.end)).toBe(mark.text);
    }
  });

  it("locks the filter switch while anything is marked", async () => {
    // The switch changes which text is on screen, and the text on screen is
    // the text that gets saved. Moving it under existing marks is the same
    // divergence by another route.
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("leaves the switch alone on a sample with no marks yet", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue({
      id: "td1",
      type: "email" as const,
      status: "pending" as const,
      annotations: { type: "email", fullText: STORED_TEXT, textSelections: [] },
      extractedData: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });
});
