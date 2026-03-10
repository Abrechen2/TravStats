import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VisModeSelector } from "../../components/VisModeSelector";

describe("VisModeSelector", () => {
  it("renders all 6 mode buttons", () => {
    render(<VisModeSelector current="routes" onChange={vi.fn()} />);
    expect(screen.getByTitle("Routes")).toBeInTheDocument();
    expect(screen.getByTitle("Globe")).toBeInTheDocument();
    expect(screen.getByTitle("Heatmap")).toBeInTheDocument();
    expect(screen.getByTitle("Hexagon")).toBeInTheDocument();
    expect(screen.getByTitle("3D Columns")).toBeInTheDocument();
    expect(screen.getByTitle("Trips")).toBeInTheDocument();
  });

  it("calls onChange with correct mode on click", () => {
    const onChange = vi.fn();
    render(<VisModeSelector current="routes" onChange={onChange} />);
    fireEvent.click(screen.getByTitle("Heatmap"));
    expect(onChange).toHaveBeenCalledWith("heatmap");
  });

  it("highlights the active mode button with ring class", () => {
    render(<VisModeSelector current="heatmap" onChange={vi.fn()} />);
    const activeBtn = screen.getByTitle("Heatmap");
    expect(activeBtn.className).toContain("ring");
  });

  it("does not highlight inactive buttons", () => {
    render(<VisModeSelector current="routes" onChange={vi.fn()} />);
    const inactiveBtn = screen.getByTitle("Heatmap");
    expect(inactiveBtn.className).not.toContain("ring");
  });

  it("sets aria-pressed=true on active button", () => {
    render(<VisModeSelector current="globe" onChange={vi.fn()} />);
    expect(screen.getByTitle("Globe")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("Routes")).toHaveAttribute("aria-pressed", "false");
  });
});
