import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VisModeSelector } from "../../components/VisModeSelector";

describe("VisModeSelector", () => {
  it("renders all 6 mode buttons", () => {
    render(<VisModeSelector current="routes" onChange={vi.fn()} />);
    expect(screen.getByTitle("Routes")).toBeInTheDocument();
    expect(screen.getByTitle("Globe")).toBeInTheDocument();
    expect(screen.getByTitle("Heat")).toBeInTheDocument();
    expect(screen.getByTitle("Hex")).toBeInTheDocument();
    expect(screen.getByTitle("3D")).toBeInTheDocument();
    expect(screen.getByTitle("Trips")).toBeInTheDocument();
  });

  it("calls onChange with correct mode on click", () => {
    const onChange = vi.fn();
    render(<VisModeSelector current="routes" onChange={onChange} />);
    fireEvent.click(screen.getByTitle("Heat"));
    expect(onChange).toHaveBeenCalledWith("heatmap");
  });

  it("marks the active mode button with aria-pressed=true", () => {
    render(<VisModeSelector current="heatmap" onChange={vi.fn()} />);
    expect(screen.getByTitle("Heat")).toHaveAttribute("aria-pressed", "true");
  });

  it("marks inactive buttons with aria-pressed=false", () => {
    render(<VisModeSelector current="routes" onChange={vi.fn()} />);
    expect(screen.getByTitle("Heat")).toHaveAttribute("aria-pressed", "false");
  });

  it("sets aria-pressed=true on active button", () => {
    render(<VisModeSelector current="globe" onChange={vi.fn()} />);
    expect(screen.getByTitle("Globe")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("Routes")).toHaveAttribute("aria-pressed", "false");
  });
});
