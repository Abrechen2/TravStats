import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TrendDelta from "./TrendDelta";

describe("TrendDelta", () => {
  it("shows an up arrow and positive percent when current > previous", () => {
    render(<TrendDelta current={120} previous={100} />);
    expect(screen.getByText(/↑/)).toBeInTheDocument();
    expect(screen.getByText(/\+20%/)).toBeInTheDocument();
  });

  it("shows a down arrow when current < previous", () => {
    render(<TrendDelta current={80} previous={100} />);
    expect(screen.getByText(/↓/)).toBeInTheDocument();
  });

  it("omits percent when previous is zero", () => {
    render(<TrendDelta current={5} previous={0} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("renders the compare label when provided", () => {
    render(<TrendDelta current={2} previous={1} compareLabel="ggü. Vorzeitraum" />);
    expect(screen.getByText(/ggü\. Vorzeitraum/)).toBeInTheDocument();
  });
});
