import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import * as api from "../../../lib/api";
import de from "../../../i18n/resources/de/training.json";

/**
 * The workshop's own copy, read in German — beta audit 2026-09-19, unlisted
 * finding 2.
 *
 * The annotation view serves four kinds of document since forgejo#124 phase 6,
 * and its instruction still said "choose a flight first" over a hotel
 * confirmation, above a ground-truth form headed "Flight Data (Ground Truth)"
 * whose sixteen labels were English in a German-first UI.
 *
 * These render the REAL resource rather than asserting on key names. A test
 * that only checks which key is used cannot see an English label sitting in
 * the German file, which is the half of this finding that a key assertion
 * would have missed.
 */

vi.mock("../../../lib/api", () => ({
  trainingApi: { getById: vi.fn(), annotate: vi.fn() },
}));

vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

/** The German resource, resolved the way react-i18next resolves it. */
function translate(key: string, options?: Record<string, unknown>): string {
  const [, path] = key.includes(":") ? key.split(":") : ["", key];
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      de
    );
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
}

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: translate }),
}));

const sampleFor = (fullText: string) => ({
  id: "td1",
  type: "email" as const,
  status: "pending" as const,
  annotations: { type: "email", fullText, textSelections: [] },
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("the annotation view's copy", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(
      sampleFor("Unterkunft: Hotel Seeblick Garni\nAnreise: 10. März 2026")
    );
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({ success: true });
  });

  it("says nothing about choosing a flight over a hotel confirmation", async () => {
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="lodging"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText(de.annotation.descriptionOther));
    expect(screen.queryByText(de.annotation.descriptionFlight)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Flug");
  });

  it("still asks a flight sample to choose its flight first", async () => {
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="flight"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText(de.annotation.descriptionFlight));
  });

  it("heads the ground-truth form and its fields in German", async () => {
    render(
      <EmailAnnotation
        trainingDataId="td1"
        domain="flight"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText(de.annotation.groundTruth.title));
    expect(screen.queryByText("Flight Data (Ground Truth)")).not.toBeInTheDocument();
    for (const label of ["flightNumber", "airline", "aircraft", "pnr", "ticketNumber"] as const) {
      expect(screen.getByText(de.annotation.groundTruth.fields[label])).toBeInTheDocument();
    }
    // The heading of the view itself, which read "Email Annotation" in both
    // resource files and so was English whichever language was chosen.
    expect(screen.getByText(de.annotation.title)).toBeInTheDocument();
    expect(screen.queryByText("Email Annotation")).not.toBeInTheDocument();
  });
});
