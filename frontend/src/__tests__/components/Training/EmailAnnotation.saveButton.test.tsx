import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  trainingApi: {
    getById: vi.fn(),
    annotate: vi.fn(),
  },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const mockTrainingData = {
  id: "td1",
  type: "email" as const,
  status: "pending" as const,
  annotations: {
    type: "email",
    fullText: "Sehr geehrter Herr Muster, Ihr Flug LH123 Frankfurt - Berlin am 01.04.2026.",
    textSelections: [],
  },
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("EmailAnnotation — save buttons", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(mockTrainingData);
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({
      success: true,
    });
  });

  it("shows exactly one save button", async () => {
    render(<EmailAnnotation trainingDataId="td1" onComplete={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    const saveButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.textContent === "training:annotation.saveOnly" ||
          b.textContent === "training:annotation.saveAndTrain"
      );
    expect(saveButtons).toHaveLength(1);
  });

  it("does not render a Save+Train button", async () => {
    render(<EmailAnnotation trainingDataId="td1" onComplete={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(screen.queryByText("training:annotation.saveAndTrain")).not.toBeInTheDocument();
  });
});
