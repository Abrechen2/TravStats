import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import * as api from "../../../lib/api";

/**
 * A sample annotated before the offsets and the saved text were made to agree
 * — review of `fix/workshop-lodging-derivation`, finding 1.
 *
 * Those rows exist: the old view measured `start`/`end` against the raw mail
 * with the filter switched off and saved the FILTERED text, so the marks point
 * into a document that is not the one stored beside them. Re-opening such a
 * sample painted highlights over the wrong words, and the new annotate guard
 * then refused the save with a 400 the reader could not clear — there is no
 * per-mark delete, Undo is empty on load, and the alert said only "Fehler beim
 * Speichern".
 *
 * So: the marks are dropped on load and the reader is told, and the guard's
 * code becomes a sentence that names the marks as the thing to fix.
 */

vi.mock("../../../lib/api", () => ({
  trainingApi: { getById: vi.fn(), annotate: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const RAW = ["Sehr geehrter Herr Muster,", "", "Unterkunft: Hotel Seeblick Garni"].join("\n");
/** What the old code stored: the filtered text, with the greeting gone. */
const STORED_TEXT = RAW.replace("Sehr geehrter Herr Muster,\n", "");
/** What the old code stored beside it: offsets taken from the RAW mail. */
const STALE_MARKS = [
  {
    start: RAW.indexOf("Hotel Seeblick Garni"),
    end: RAW.indexOf("Hotel Seeblick Garni") + "Hotel Seeblick Garni".length,
    text: "Hotel Seeblick Garni",
    label: "hotelName",
  },
];

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

describe("EmailAnnotation — a sample whose stored marks no longer fit", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops the marks and says so", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: STORED_TEXT, textSelections: STALE_MARKS })
    );
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("training:annotation.marksDropped"));

    // And the save that follows carries no marks, so it cannot be refused.
    await userEvent.click(screen.getByText("training:annotation.saveOnly"));
    await waitFor(() => expect(api.trainingApi.annotate).toHaveBeenCalled());
    const [, annotations] = vi.mocked(api.trainingApi.annotate).mock.calls[0];
    expect((annotations as { textSelections: unknown[] }).textSelections).toEqual([]);
  });

  it("keeps marks that still fit, and says nothing", async () => {
    const aligned = [
      {
        start: STORED_TEXT.indexOf("Hotel Seeblick Garni"),
        end: STORED_TEXT.indexOf("Hotel Seeblick Garni") + "Hotel Seeblick Garni".length,
        text: "Hotel Seeblick Garni",
        label: "hotelName",
      },
    ];
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: STORED_TEXT, textSelections: aligned })
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
    expect(screen.queryByText("training:annotation.marksDropped")).not.toBeInTheDocument();
  });

  it("turns the guard's refusal into a sentence about the marks", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: STORED_TEXT, textSelections: [] })
    );
    vi.mocked(api.trainingApi.annotate).mockRejectedValue({
      response: { status: 400, data: { code: "ANNOTATION_TEXT_MISMATCH" } },
    });
    const alerted = vi.spyOn(window, "alert").mockImplementation(() => undefined);

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

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent("training:errors.marksOutOfSync");
    expect(alerted).toHaveBeenCalledWith("training:errors.marksOutOfSync");
    // Never the code itself.
    expect(document.body.textContent).not.toContain("ANNOTATION_TEXT_MISMATCH");
  });

  it("keeps the generic sentence for a failure that is not about the marks", async () => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sample({ type: "email", fullText: STORED_TEXT, textSelections: [] })
    );
    vi.mocked(api.trainingApi.annotate).mockRejectedValue({ response: { status: 500, data: {} } });
    vi.spyOn(window, "alert").mockImplementation(() => undefined);

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

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent("training:errors.saveFailed");
  });
});
