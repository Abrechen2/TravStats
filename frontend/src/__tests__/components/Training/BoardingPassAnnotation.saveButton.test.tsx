import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import BoardingPassAnnotation from "../../../components/Training/BoardingPassAnnotation";
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

vi.mock("tesseract.js", () => ({
  default: { recognize: vi.fn().mockResolvedValue({ data: { text: "" } }) },
}));

const mockTrainingData = {
  id: "td2",
  type: "boarding_pass" as const,
  status: "pending" as const,
  annotations: {
    type: "boarding_pass",
    imageBase64: "data:image/png;base64,abc",
    boundingBoxes: [],
  },
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("BoardingPassAnnotation — save buttons", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(mockTrainingData);
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({ success: true });
  });

  it("shows exactly one save button", async () => {
    render(<BoardingPassAnnotation trainingDataId="td2" onComplete={vi.fn()} onCancel={vi.fn()} />);
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
    render(<BoardingPassAnnotation trainingDataId="td2" onComplete={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByText("training:annotation.saveOnly"));
    expect(screen.queryByText("training:annotation.saveAndTrain")).not.toBeInTheDocument();
  });
});
